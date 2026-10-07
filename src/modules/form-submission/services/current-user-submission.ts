import mongoose from "mongoose";
import {
  isUploadExtensionInCategory,
  normalizeUploadExtension,
} from "#app/modules/file-upload/policy";
import Form from "#app/modules/form/models/index";
import FormSubmissionStatus from "#app/modules/form-submission-status/models/index";
import FormSubmission from "#app/modules/form-submission/models/index";
import {
  validateFormAnswers,
  type SubmissionSection,
} from "#app/modules/form-submission/services/validate-form-answers";
import type { StoredFileMetadata } from "#app/services/storage/index";
import { AppError, badRequest, conflict, notFound } from "#app/utils/errors";

export type SubmissionForm = {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  name: string;
  type: string;
  description?: string;
  displayMode?: string;
  sections: SubmissionSection[];
  isClosed: boolean;
};

export type Submission = {
  _id: mongoose.Types.ObjectId;
  submissionStatusId: mongoose.Types.ObjectId;
  submittedAt: Date | null;
  updatedAt: Date;
  searchKeywords?: string;
  answers: Record<string, unknown>;
};

export async function findForm(formId: string) {
  const form = (await Form.findOne({
    _id: formId,
    type: "AUTHENTICATED",
    archivedAt: null,
  })
    .select("organizationId name type description sections displayMode isClosed")
    .lean()) as SubmissionForm | null;
  if (!form) throw notFound("Form");
  return form;
}

export async function findSubmission(form: SubmissionForm, userId: string) {
  const submission = (await FormSubmission.findOne({
    formId: form._id,
    submittedBy: userId,
  }).lean()) as Submission | null;
  if (!submission) throw notFound("Submission");
  return submission;
}

export function formClosed() {
  return new AppError("This form is closed.", { statusCode: 409, code: "FORM_CLOSED" });
}

export async function assertEditable(form: SubmissionForm, submission: Submission) {
  if (form.isClosed) throw formClosed();
  const status = await FormSubmissionStatus.findOne({
    _id: submission.submissionStatusId,
    organizationId: form.organizationId,
    formId: form._id,
  })
    .select("isSubmissionLocked")
    .lean();
  if (!status || status.isSubmissionLocked) {
    throw conflict("Answers are locked in this submission status.");
  }
}

export function visibleQuestions(form: SubmissionForm) {
  return form.sections
    .filter((section) => !section.isHidden)
    .flatMap((section) => section.questions);
}

export function isStoredFile(value: unknown): value is StoredFileMetadata {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "url" in value &&
    typeof value.url === "string"
  );
}

export function validateSavedAnswers(form: SubmissionForm, answers: Record<string, unknown>) {
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
      if (
        !isUploadExtensionInCategory(category, extension) ||
        (category !== "all" &&
          question.typeConfig?.allowedExtensions?.length &&
          !question.typeConfig.allowedExtensions.includes(extension))
      ) {
        throw badRequest("A saved file is no longer allowed for this question.", {
          questionId: question._id,
        });
      }
    }
    uploadedFiles[question._id] = files;
  }
  return validateFormAnswers(form.sections, values, uploadedFiles);
}

export function submissionData(submission: Submission) {
  return {
    id: String(submission._id),
    submissionStatusId: String(submission.submissionStatusId),
    submittedAt: submission.submittedAt,
    updatedAt: submission.updatedAt,
    answers: Object.fromEntries(
      Object.entries(submission.answers).map(([questionId, value]) => [
        questionId,
        Array.isArray(value)
          ? value.map((item) =>
              isStoredFile(item)
                ? {
                    id: item.id,
                    name: item.originalName,
                    url: item.url,
                    mimeType: item.mimeType,
                    size: item.size,
                  }
                : item,
            )
          : value,
      ]),
    ),
  };
}
