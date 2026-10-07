import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import Form from "#app/modules/form/models/index";
import FormSubmission from "#app/modules/form-submission/models/index";
import User from "#app/modules/user/models/index";
import { badRequest, notFound } from "#app/utils/errors";
import type { StoredFileMetadata } from "#app/services/storage/index";

const router = Router({ mergeParams: true });
const PAGE_SIZE = 20;
const formIdSchema = z.string().refine(mongoose.isValidObjectId, {
  message: "A valid form ID is required.",
});

/** GET /api/orgs/:organizationSlug/forms/:formId/submissions */
router.get<{ formId: string }>(
  "/",
  authorize("submission.read"),
  validate({
    params: z.object({ formId: formIdSchema }),
    query: z.object({
      page: z
        .string()
        .refine(
          (value) =>
            /^[1-9]\d*$/.test(value) &&
            Number.isSafeInteger(Number(value)) &&
            (Number(value) - 1) * PAGE_SIZE <= Number.MAX_SAFE_INTEGER,
          {
            message: "page must be a positive integer.",
          },
        )
        .optional(),
      search: z.string().trim().max(100).optional(),
      status: z.enum(["all", "submitted", "started"]).optional(),
      submissionStatusId: z
        .string()
        .refine(mongoose.isValidObjectId, {
          message: "A valid submission status ID is required.",
        })
        .optional(),
      sort: z.enum(["newest", "oldest"]).optional(),
      dateFrom: z.iso.datetime().optional(),
      dateBefore: z.iso.datetime().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const organizationId = req.organizationAccess!.organizationId;
      const formId = req.params.formId;
      const form = await Form.findOne({ _id: formId, organizationId, archivedAt: null })
        .select("type")
        .lean();
      if (!form) throw notFound("Form");
      const page = Number(req.query.page ?? 1);
      const status = req.query.status ?? "submitted";
      const direction = req.query.sort === "oldest" ? 1 : -1;
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      if (search && form.type !== "AUTHENTICATED") {
        throw badRequest("Search is only available for authenticated forms.");
      }
      if (status !== "submitted" && form.type !== "AUTHENTICATED") {
        throw badRequest("Started submissions are only available for authenticated forms.");
      }
      const searchTerm = sanitizeSearchTerm(search) ?? search;
      const scope = {
        formId: new mongoose.Types.ObjectId(formId),
        organizationId: new mongoose.Types.ObjectId(organizationId),
        ...(status === "submitted"
          ? { submittedAt: { $ne: null } }
          : status === "started"
            ? { submittedAt: null }
            : {}),
        ...(req.query.submissionStatusId
          ? {
              submissionStatusId: new mongoose.Types.ObjectId(String(req.query.submissionStatusId)),
            }
          : {}),
        ...(searchTerm
          ? {
              searchKeywords: new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
            }
          : {}),
      };
      const dateScope = {
        ...(req.query.dateFrom ? { $gte: new Date(String(req.query.dateFrom)) } : {}),
        ...(req.query.dateBefore ? { $lt: new Date(String(req.query.dateBefore)) } : {}),
      };
      const [result] = await FormSubmission.aggregate<{
        items: Array<{
          _id: mongoose.Types.ObjectId;
          submittedAt: Date | null;
          createdAt: Date;
          submittedBy: mongoose.Types.ObjectId | null;
          submissionStatusId: mongoose.Types.ObjectId | null;
          answers: Record<string, unknown>;
        }>;
        count: Array<{ value: number }>;
      }>([
        { $match: scope },
        { $addFields: { sortAt: { $ifNull: ["$submittedAt", "$createdAt"] } } },
        ...(Object.keys(dateScope).length ? [{ $match: { sortAt: dateScope } }] : []),
        {
          $facet: {
            items: [
              { $sort: { sortAt: direction, _id: direction } },
              { $skip: (page - 1) * PAGE_SIZE },
              { $limit: PAGE_SIZE },
              {
                $project: {
                  submittedAt: 1,
                  createdAt: 1,
                  submittedBy: 1,
                  submissionStatusId: 1,
                  answers: 1,
                },
              },
            ],
            count: [{ $count: "value" }],
          },
        },
      ]);
      const submissions = result.items;
      const total = result.count[0]?.value ?? 0;
      const userIds = submissions.flatMap((submission) =>
        submission.submittedBy ? [submission.submittedBy] : [],
      );
      const users = userIds.length
        ? await User.find({ _id: { $in: userIds } })
            .select("_id firstName lastName email profilePic")
            .lean()
        : [];
      const usersById = new Map(users.map((user) => [String(user._id), user]));

      return res.status(200).json({
        success: true,
        data: {
          items: submissions.map((submission) => {
            const user = submission.submittedBy
              ? usersById.get(String(submission.submittedBy))
              : null;
            const name = user ? [user.firstName, user.lastName].filter(Boolean).join(" ") : "";

            return {
              id: String(submission._id),
              submittedAt: submission.submittedAt,
              startedAt: submission.createdAt,
              submissionStatusId: submission.submissionStatusId
                ? String(submission.submissionStatusId)
                : null,
              submittedBy: !submission.submittedBy
                ? { kind: "anonymous" }
                : user
                  ? {
                      kind: "user",
                      name: name || user.email,
                      email: user.email,
                      profilePic: user.profilePic || null,
                    }
                  : { kind: "former-user" },
              answers: toAnswersData(submission.answers),
            };
          }),
          total,
          page,
          pageSize: PAGE_SIZE,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;

function sanitizeSearchTerm(term: string): string | null {
  if (!term.includes("@")) return null;

  const cleaned = term.toLowerCase().trim();
  const [localPart, domainPart] = cleaned.split("@");
  if (!domainPart?.trim()) return localPart || null;

  const genericDomains = [
    "@gmail.com",
    "@yahoo.com",
    "@outlook.com",
    "@hotmail.com",
    "@aol.com",
    "@icloud.com",
  ];
  if (genericDomains.some((domain) => cleaned.endsWith(domain))) return localPart || null;
  return domainPart.split(".")[0] || null;
}

function toAnswersData(answers: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(answers).map(([questionId, value]) => [
      questionId,
      Array.isArray(value)
        ? value.map((item) =>
            typeof item === "object" &&
            item !== null &&
            "url" in item &&
            typeof item.url === "string"
              ? {
                  name: (item as StoredFileMetadata).originalName,
                  url: item.url,
                  mimeType: (item as StoredFileMetadata).mimeType,
                  size: (item as StoredFileMetadata).size,
                }
              : item,
          )
        : value,
    ]),
  );
}
