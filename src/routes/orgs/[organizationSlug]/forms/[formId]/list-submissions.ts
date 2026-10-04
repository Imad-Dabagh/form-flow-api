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
const cursorSchema = z.strictObject({
  submittedAt: z.iso.datetime(),
  id: z.string().refine(mongoose.isValidObjectId),
});

/** GET /api/orgs/:organizationSlug/forms/:formId/submissions */
router.get(
  "/",
  authorize("submission.read"),
  validate({
    params: z.object({ formId: formIdSchema }),
    query: z.object({ cursor: z.string().min(1).max(256).optional() }),
  }),
  async (req, res, next) => {
    try {
      const organizationId = req.organizationAccess!.organizationId;
      const formId = req.params.formId;
      const form = await Form.exists({ _id: formId, organizationId, archivedAt: null });
      if (!form) throw notFound("Form");
      const cursor = typeof req.query.cursor === "string" ? decodeCursor(req.query.cursor) : null;
      const scope = { formId, organizationId, submittedAt: { $ne: null } };
      const olderThanCursor = cursor ? {
        $or: [
          { submittedAt: { $lt: cursor.submittedAt } },
          { submittedAt: cursor.submittedAt, _id: { $lt: cursor.id } },
        ],
      } : {};

      const submissions = await FormSubmission.find({ ...scope, ...olderThanCursor })
        .select("_id submittedAt submittedBy answers")
        .sort({ submittedAt: -1, _id: -1 })
        .limit(PAGE_SIZE + 1)
        .lean();
      const page = submissions.slice(0, PAGE_SIZE);
      const userIds = page.flatMap((submission) =>
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
          items: page.map((submission) => {
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
          nextCursor: submissions.length > PAGE_SIZE && page.length
            ? encodeCursor(page[page.length - 1])
            : null,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;

function decodeCursor(value: string) {
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return { submittedAt: new Date(parsed.submittedAt), id: new mongoose.Types.ObjectId(parsed.id) };
  } catch {
    throw badRequest("A valid submissions cursor is required.");
  }
}

function encodeCursor(submission: { _id: mongoose.Types.ObjectId; submittedAt?: Date | null }) {
  if (!submission.submittedAt) throw new Error("A completed submission needs submittedAt.");
  return Buffer.from(JSON.stringify({
    submittedAt: submission.submittedAt.toISOString(),
    id: String(submission._id),
  })).toString("base64url");
}

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
