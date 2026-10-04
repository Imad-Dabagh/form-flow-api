import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import Form from "#app/modules/form/models/index";
import FormSubmission from "#app/modules/form-submission/models/index";
import User from "#app/modules/user/models/index";
import { notFound } from "#app/utils/errors";
import type { StoredFileMetadata } from "#app/services/storage/index";

const router = Router({ mergeParams: true });
const PAGE_SIZE = 20;
const formIdSchema = z.string().refine(mongoose.isValidObjectId, {
  message: "A valid form ID is required.",
});

/** GET /api/orgs/:organizationSlug/forms/:formId/submissions */
router.get(
  "/",
  authorize("submission.read"),
  validate({
    params: z.object({ formId: formIdSchema }),
    query: z.object({
      page: z.string().refine((value) => /^[1-9]\d*$/.test(value)
        && Number.isSafeInteger(Number(value))
        && (Number(value) - 1) * PAGE_SIZE <= Number.MAX_SAFE_INTEGER, {
        message: "page must be a positive integer.",
      }).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const organizationId = req.organizationAccess!.organizationId;
      const formId = req.params.formId;
      const form = await Form.exists({ _id: formId, organizationId, archivedAt: null });
      if (!form) throw notFound("Form");
      const page = Number(req.query.page ?? 1);
      const scope = { formId, organizationId, submittedAt: { $ne: null } };
      const [submissions, total] = await Promise.all([
        FormSubmission.find(scope)
          .select("_id submittedAt submittedBy answers")
          .sort({ submittedAt: -1, _id: -1 })
          .skip((page - 1) * PAGE_SIZE)
          .limit(PAGE_SIZE)
          .lean(),
        FormSubmission.countDocuments(scope),
      ]);
      const userIds = submissions.flatMap((submission) =>
        submission.submittedBy ? [submission.submittedBy] : []);
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
              ? usersById.get(String(submission.submittedBy)) : null;
            const name = user
              ? [user.firstName, user.lastName].filter(Boolean).join(" ")
              : "";

            return {
              id: String(submission._id),
              submittedAt: submission.submittedAt,
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

function toAnswersData(answers: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(answers).map(([questionId, value]) => [
    questionId,
    Array.isArray(value) ? value.map((item) =>
      typeof item === "object" && item !== null && "url" in item && typeof item.url === "string"
        ? {
          name: (item as StoredFileMetadata).originalName,
          url: item.url,
          mimeType: (item as StoredFileMetadata).mimeType,
          size: (item as StoredFileMetadata).size,
        }
        : item) : value,
  ]));
}
