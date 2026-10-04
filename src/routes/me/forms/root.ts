import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import { z } from "zod";
import { validate } from "#app/middlewares/index";
import { ORGANIZATION_ROLES } from "#app/modules/_shared/constants";
import { authenticatedUploadRateLimit } from "#app/modules/file-upload/authenticated-rate-limit";
import { isUploadExtensionInCategory, normalizeUploadExtension } from "#app/modules/file-upload/policy";
import Form from "#app/modules/form/models/index";
import { toSubmissionFormPresentation } from "#app/modules/form/submission-form-presentation";
import FormSubmission from "#app/modules/form-submission/models/index";
import { uploadQuestionFile } from "#app/modules/form-submission/services/upload-question-file";
import { validateFormAnswers, type SubmissionSection } from "#app/modules/form-submission/services/validate-form-answers";
import Membership from "#app/modules/membership/models/index";
import User from "#app/modules/user/models/index";
import { Logger } from "#app/services/index";
import { storageProvider, type StoredFileMetadata } from "#app/services/storage/index";
import { AppError, badRequest, conflict, notFound, tooManyRequests } from "#app/utils/errors";

const router = Router({ mergeParams: true });
const formIdSchema = z.string().refine(mongoose.isValidObjectId, "A valid form ID is required.");
const saveSchema = z.strictObject({
  formAnswers: z.record(z.string(), z.union([
    z.string(), z.number().finite(), z.boolean(), z.array(z.string()), z.null(),
  ])),
});

router.use(rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 120,
  keyGenerator: (req) => req.auth!.userId,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(tooManyRequests("Submission request limit reached. Try again later.")),
}));
router.use(validate({ params: z.object({ formId: formIdSchema }) }));
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

/** GET /api/me/forms/:formId/submission — open or resume. */
router.get<{ formId: string }>("/", async (req, res, next) => {
  try {
    const form = await findForm(req.params.formId);
    const userId = req.auth!.userId;
    const user = await User.findById(userId).select("firstName lastName email phone").lean();
    if (!user) throw notFound("User");
    const searchKeywords = generateKeywords(user);
    let submission = await FormSubmission.findOne({ formId: form._id, submittedBy: userId }).lean() as Submission | null;

    if (!submission) {
      if (form.isClosed) throw formClosed();
      submission = await FormSubmission.findOneAndUpdate(
        { formId: form._id, submittedBy: userId },
        { $setOnInsert: {
          organizationId: form.organizationId,
          answers: {},
          submittedAt: null,
          searchKeywords,
        } },
        { upsert: true, returnDocument: "after", runValidators: true },
      ).lean() as Submission | null;
    }
    if (!submission) throw notFound("Submission");
    if (submission.searchKeywords !== searchKeywords) {
      await FormSubmission.updateOne({ _id: submission._id }, { $set: { searchKeywords } });
    }

    await Membership.updateOne(
      { userId, organizationId: form.organizationId },
      { $setOnInsert: { role: ORGANIZATION_ROLES.USER } },
      { upsert: true },
    );

    return res.status(200).json({
      success: true,
      data: { form: toSubmissionFormPresentation(form), submission: submissionData(submission) },
    });
  } catch (error) {
    return next(error);
  }
});

/** PUT /api/me/forms/:formId/submission — save progress. */
router.put<{ formId: string }>("/", async (req, res, next) => {
  try {
    const input = saveSchema.safeParse(req.body);
    if (!input.success) throw badRequest("Send a formAnswers object.");

    const form = await findForm(req.params.formId);
    const submission = await findSubmission(form, req.auth!.userId);
    assertEditable(form, submission);

    const questions = visibleQuestions(form);
    const editableIds = new Set(questions.filter((question) => question.inputType !== "file").map((question) => question._id));
    const fileIds = new Set(questions.filter((question) => question.inputType === "file").map((question) => question._id));
    if (Object.keys(input.data.formAnswers).some((id) => !editableIds.has(id))) {
      throw badRequest("An answer does not belong to a visible non-file question.");
    }

    const files = Object.fromEntries(
      Object.entries(submission.answers).filter(([id]) => fileIds.has(id)),
    );
    const answers = { ...input.data.formAnswers, ...files };
    const updated = await FormSubmission.findOneAndUpdate(
      { _id: submission._id, submittedAt: null },
      { $set: { answers } },
      { returnDocument: "after", runValidators: true },
    ).lean() as Submission | null;
    if (!updated) throw conflict("This submission has already been submitted.");

    return res.status(200).json({ success: true, data: submissionData(updated) });
  } catch (error) {
    return next(error);
  }
});

/** PUT /api/me/forms/:formId/submission/submit — validate and finish. */
router.put<{ formId: string }>("/submit", async (req, res, next) => {
  try {
    const form = await findForm(req.params.formId);
    const submission = await findSubmission(form, req.auth!.userId);
    if (submission.submittedAt) {
      return res.status(200).json({ success: true, data: submissionData(submission) });
    }
    assertEditable(form, submission);

    const answers = validateSavedAnswers(form, submission.answers);
    const updated = await FormSubmission.findOneAndUpdate(
      { _id: submission._id, submittedAt: null },
      { $set: { answers, submittedAt: new Date() } },
      { returnDocument: "after", runValidators: true },
    ).lean() as Submission | null;
    if (updated) return res.status(200).json({ success: true, data: submissionData(updated) });

    const latest = await findSubmission(form, req.auth!.userId);
    if (latest.submittedAt) return res.status(200).json({ success: true, data: submissionData(latest) });
    throw conflict("This submission changed while submitting. Reload it and try again.");
  } catch (error) {
    return next(error);
  }
});

/** POST /api/me/forms/:formId/submission/files/:questionId */
router.post("/files/:questionId", authenticatedUploadRateLimit, validate({
  params: z.object({ formId: formIdSchema, questionId: z.string().min(1).max(128) }),
}), async (req, res, next) => {
  try {
    const form = await findForm(req.params.formId as string);
    const submission = await findSubmission(form, req.auth!.userId);
    assertEditable(form, submission);

    const questionId = req.params.questionId as string;
    const question = visibleQuestions(form).find((item) => item._id === questionId && item.inputType === "file");
    if (!question) throw notFound("File question");
    if (storedFiles(submission.answers).length >= 10) throw badRequest("A submission can contain at most 10 files.");

    const uploaded = await uploadQuestionFile({ request: req, form, questionId });
    try {
      const previous = submission.answers[questionId];
      const files = Array.isArray(previous) ? previous.filter(isStoredFile) : [];
      const updated = await FormSubmission.findOneAndUpdate(
        { _id: submission._id, submittedAt: null },
        { $set: { answers: { ...submission.answers, [questionId]: [...files, uploaded] } } },
        { returnDocument: "after", runValidators: true },
      ).lean() as Submission | null;
      if (!updated) throw conflict("This submission has already been submitted.");
      return res.status(201).json({ success: true, data: submissionData(updated) });
    } catch (error) {
      await storageProvider.delete(uploaded).catch((cleanupError: unknown) => {
        Logger.warn("Could not clean up an unattached submission file", cleanupError);
      });
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

/** DELETE /api/me/forms/:formId/submission/files/:fileId */
router.delete("/files/:fileId", validate({
  params: z.object({ formId: formIdSchema, fileId: z.string().min(1).max(128) }),
}), async (req, res, next) => {
  try {
    const form = await findForm(req.params.formId as string);
    const submission = await findSubmission(form, req.auth!.userId);
    assertEditable(form, submission);

    const fileId = req.params.fileId as string;
    const entry = storedFiles(submission.answers).find(({ file }) => file.id === fileId);
    if (!entry) throw notFound("Submission file");

    const answers = { ...submission.answers };
    const remaining = (answers[entry.questionId] as StoredFileMetadata[]).filter((file) => file.id !== fileId);
    if (remaining.length) answers[entry.questionId] = remaining;
    else delete answers[entry.questionId];

    const updated = await FormSubmission.findOneAndUpdate(
      { _id: submission._id, submittedAt: null },
      { $set: { answers } },
      { returnDocument: "after", runValidators: true },
    ).lean() as Submission | null;
    if (!updated) throw conflict("This submission has already been submitted.");

    await storageProvider.delete(entry.file).catch((cleanupError: unknown) => {
      Logger.warn("Could not clean up a removed submission file", cleanupError);
    });
    return res.status(200).json({ success: true, data: submissionData(updated) });
  } catch (error) {
    return next(error);
  }
});

export default router;

type SubmissionForm = {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  name: string;
  type: string;
  description?: string;
  displayMode?: string;
  sections: SubmissionSection[];
  isClosed: boolean;
};

type Submission = {
  _id: mongoose.Types.ObjectId;
  submittedAt: Date | null;
  updatedAt: Date;
  searchKeywords?: string;
  answers: Record<string, unknown>;
};

function generateKeywords(user: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  return [user.firstName, user.lastName, user.email, user.phone]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .join(" ")
    .substring(0, 99);
}

async function findForm(formId: string) {
  const form = await Form.findOne({
    _id: formId,
    type: "AUTHENTICATED",
    archivedAt: null,
  }).select("organizationId name type description sections displayMode isClosed").lean() as SubmissionForm | null;
  if (!form) throw notFound("Form");
  return form;
}

async function findSubmission(form: SubmissionForm, userId: string) {
  const submission = await FormSubmission.findOne({
    formId: form._id,
    submittedBy: userId,
  }).lean() as Submission | null;
  if (!submission) throw notFound("Submission");
  return submission;
}

function formClosed() {
  return new AppError("This form is closed.", { statusCode: 409, code: "FORM_CLOSED" });
}

function assertEditable(form: SubmissionForm, submission: Submission) {
  if (submission.submittedAt) throw conflict("This submission has already been submitted.");
  if (form.isClosed) throw formClosed();
}

function visibleQuestions(form: SubmissionForm) {
  return form.sections.filter((section) => !section.isHidden).flatMap((section) => section.questions);
}

function isStoredFile(value: unknown): value is StoredFileMetadata {
  return typeof value === "object" && value !== null &&
    "id" in value && typeof value.id === "string" &&
    "url" in value && typeof value.url === "string";
}

function storedFiles(answers: Record<string, unknown>) {
  return Object.entries(answers).flatMap(([questionId, value]) =>
    Array.isArray(value)
      ? value.filter(isStoredFile).map((file) => ({ questionId, file }))
      : []);
}

function submissionData(submission: Submission) {
  return {
    id: String(submission._id),
    submittedAt: submission.submittedAt,
    updatedAt: submission.updatedAt,
    answers: Object.fromEntries(Object.entries(submission.answers).map(([questionId, value]) => [
      questionId,
      Array.isArray(value) ? value.map((item) => isStoredFile(item)
        ? { id: item.id, name: item.originalName, url: item.url, mimeType: item.mimeType, size: item.size }
        : item) : value,
    ])),
  };
}

function validateSavedAnswers(form: SubmissionForm, answers: Record<string, unknown>) {
  const values = { ...answers };
  const uploadedFiles: Record<string, StoredFileMetadata[]> = {};
  for (const question of visibleQuestions(form).filter((item) => item.inputType === "file")) {
    const files = values[question._id];
    delete values[question._id];
    if (files === undefined) continue;
    if (!Array.isArray(files) || files.some((file) => !isStoredFile(file))) {
      throw badRequest("A saved file is invalid.", { questionId: question._id });
    }
    for (const file of files) {
      const category = question.typeConfig?.uploadCategory ?? "all";
      const extension = normalizeUploadExtension(file.extension);
      if (!isUploadExtensionInCategory(category, extension) ||
        (category !== "all" && question.typeConfig?.allowedExtensions?.length &&
          !question.typeConfig.allowedExtensions.includes(extension))) {
        throw badRequest("A saved file is no longer allowed for this question.", { questionId: question._id });
      }
    }
    uploadedFiles[question._id] = files;
  }
  return validateFormAnswers(form.sections, values, uploadedFiles);
}
