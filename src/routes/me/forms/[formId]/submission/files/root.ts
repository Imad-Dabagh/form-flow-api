import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { validate } from "#app/middlewares/index";
import { authenticatedUploadRateLimit } from "#app/modules/file-upload/authenticated-rate-limit";
import FormSubmission from "#app/modules/form-submission/models/index";
import { uploadQuestionFile } from "#app/modules/form-submission/services/upload-question-file";
import { Logger } from "#app/services/index";
import { storageProvider, type StoredFileMetadata } from "#app/services/storage/index";
import { badRequest, conflict, notFound } from "#app/utils/errors";
import {
  assertEditable,
  findForm,
  findSubmission,
  isStoredFile,
  submissionData,
  validateSavedAnswers,
  visibleQuestions,
  type Submission,
} from "#app/modules/form-submission/services/current-user-submission";

const router = Router({ mergeParams: true });
const formIdSchema = z.string().refine(mongoose.isValidObjectId, "A valid form ID is required.");

/** POST /api/me/forms/:formId/submission/files/:questionId */
router.post("/:questionId", authenticatedUploadRateLimit, validate({
  params: z.object({ formId: formIdSchema, questionId: z.string().min(1).max(128) }),
  query: z.object({ replaceFileId: z.string().min(1).max(128).optional() }),
}), async (req, res, next) => {
  try {
    const form = await findForm(req.params.formId as string);
    const submission = await findSubmission(form, req.auth!.userId);
    await assertEditable(form, submission);

    const questionId = req.params.questionId as string;
    const question = visibleQuestions(form).find((item) => item._id === questionId && item.inputType === "file");
    if (!question) throw notFound("File question");
    const replacement = req.query.replaceFileId
      ? storedFiles(submission.answers).find(({ questionId: storedQuestionId, file }) =>
        storedQuestionId === questionId && file.id === req.query.replaceFileId)
      : undefined;
    if (req.query.replaceFileId && !replacement) throw notFound("Submission file");
    if (storedFiles(submission.answers).length >= 10 && !replacement) {
      throw badRequest("A submission can contain at most 10 files.");
    }

    const uploaded = await uploadQuestionFile({ request: req, form, questionId });
    try {
      const previous = submission.answers[questionId];
      const files = Array.isArray(previous)
        ? previous.filter(isStoredFile).filter((file) => file.id !== replacement?.file.id)
        : [];
      const updated = await FormSubmission.findOneAndUpdate(
        { _id: submission._id, submissionStatusId: submission.submissionStatusId,
          submittedAt: submission.submittedAt },
        { $set: { answers: submission.submittedAt
          ? validateSavedAnswers(form, { ...submission.answers, [questionId]: [...files, uploaded] })
          : { ...submission.answers, [questionId]: [...files, uploaded] } } },
        { returnDocument: "after", runValidators: true },
      ).lean() as Submission | null;
      if (!updated) throw conflict("This submission changed while uploading. Reload it and try again.");
      if (replacement) {
        await storageProvider.delete(replacement.file).catch((cleanupError: unknown) => {
          Logger.warn("Could not clean up a replaced submission file", cleanupError);
        });
      }
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
router.delete("/:fileId", validate({
  params: z.object({ formId: formIdSchema, fileId: z.string().min(1).max(128) }),
}), async (req, res, next) => {
  try {
    const form = await findForm(req.params.formId as string);
    const submission = await findSubmission(form, req.auth!.userId);
    await assertEditable(form, submission);

    const fileId = req.params.fileId as string;
    const entry = storedFiles(submission.answers).find(({ file }) => file.id === fileId);
    if (!entry) throw notFound("Submission file");

    const answers = { ...submission.answers };
    const remaining = (answers[entry.questionId] as StoredFileMetadata[]).filter((file) => file.id !== fileId);
    if (remaining.length) answers[entry.questionId] = remaining;
    else delete answers[entry.questionId];

    const updated = await FormSubmission.findOneAndUpdate(
      { _id: submission._id, submissionStatusId: submission.submissionStatusId,
        submittedAt: submission.submittedAt },
      { $set: { answers: submission.submittedAt ? validateSavedAnswers(form, answers) : answers } },
      { returnDocument: "after", runValidators: true },
    ).lean() as Submission | null;
    if (!updated) throw conflict("This submission changed while removing a file. Reload it and try again.");

    await storageProvider.delete(entry.file).catch((cleanupError: unknown) => {
      Logger.warn("Could not clean up a removed submission file", cleanupError);
    });
    return res.status(200).json({ success: true, data: submissionData(updated) });
  } catch (error) {
    return next(error);
  }
});

export default router;

function storedFiles(answers: Record<string, unknown>) {
  return Object.entries(answers).flatMap(([questionId, value]) =>
    Array.isArray(value)
      ? value.filter(isStoredFile).map((file) => ({ questionId, file }))
      : []);
}
