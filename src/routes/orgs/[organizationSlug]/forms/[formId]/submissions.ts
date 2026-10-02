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

function decodeCursor(value: string) {
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return { submittedAt: new Date(parsed.submittedAt), id: new mongoose.Types.ObjectId(parsed.id) };
  } catch {
    throw badRequest("A valid submissions cursor is required.");
  }
}

function encodeCursor(submission: { _id: mongoose.Types.ObjectId; createdAt: Date }) {
  return Buffer.from(JSON.stringify({
    submittedAt: submission.createdAt.toISOString(),
    id: String(submission._id),
  })).toString("base64url");
}

interface StoredAnswer {
  sectionId: string;
  sectionTitle: string;
  questionId: string;
  questionTitle: string;
  inputType: string;
  value: unknown;
  selectedOptions?: Array<{ value: string; label: string }>;
}

function toAnswerResponse(answer: StoredAnswer) {
  const value = answer.inputType === "file" && Array.isArray(answer.value)
    ? answer.value.filter((file): file is StoredFileMetadata =>
      typeof file === "object" && file !== null && typeof file.url === "string")
      .map((file) => ({
        name: file.originalName ?? file.name,
        url: file.url,
        mimeType: file.mimeType,
        size: file.size,
      }))
    : answer.value;

  return {
    sectionId: answer.sectionId,
    sectionTitle: answer.sectionTitle,
    questionId: answer.questionId,
    questionTitle: answer.questionTitle,
    inputType: answer.inputType,
    value,
    ...(answer.selectedOptions?.length ? {
      selectedOptions: answer.selectedOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    } : {}),
  };
}

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
      const scope = { formId, organizationId };
      const olderThanCursor = cursor ? {
        $or: [
          { createdAt: { $lt: cursor.submittedAt } },
          { createdAt: cursor.submittedAt, _id: { $lt: cursor.id } },
        ],
      } : {};

      const submissions = await FormSubmission.find({ ...scope, ...olderThanCursor })
        .select("_id createdAt submittedBy answers")
        .sort({ createdAt: -1, _id: -1 })
        .limit(PAGE_SIZE + 1)
        .lean();
      const page = submissions.slice(0, PAGE_SIZE);
      const respondentIds = page.flatMap((submission) =>
        submission.submittedBy ? [submission.submittedBy] : []);
      const respondents = respondentIds.length
        ? await User.find({ _id: { $in: respondentIds } })
          .select("_id firstName lastName email")
          .lean()
        : [];
      const respondentsById = new Map(respondents.map((user) => [String(user._id), user]));

      return res.status(200).json({
        success: true,
        data: {
          items: page.map((submission) => {
            const respondent = submission.submittedBy
              ? respondentsById.get(String(submission.submittedBy)) : null;
            const name = respondent
              ? [respondent.firstName, respondent.lastName].filter(Boolean).join(" ")
              : "";

            return {
              id: String(submission._id),
              submittedAt: submission.createdAt,
              respondent: !submission.submittedBy
                ? { kind: "anonymous" }
                : respondent
                  ? { kind: "user", name: name || respondent.email, email: respondent.email }
                  : { kind: "former-user" },
              answers: submission.answers.map(toAnswerResponse),
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
