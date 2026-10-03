import type { Request } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import Form from "#app/modules/form/models/index";
import FormSubmission from "#app/modules/form-submission/models/index";
import { isUploadExtensionInCategory, normalizeUploadExtension } from "#app/modules/file-upload/policy";
import { Logger } from "#app/services/index";
import { storageProvider, type StoredFileMetadata } from "#app/services/storage/index";
import { AppError, badRequest, conflict, notFound } from "#app/utils/errors";
import { uploadQuestionFile } from "./upload-question-file.js";
import { validateFormAnswers, type SubmissionSection } from "./validate-form-answers.js";

type DraftForm = {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  name: string;
  sections: SubmissionSection[];
  isClosed: boolean;
};
type DraftAnswer = {
  sectionId: string;
  sectionTitle: string;
  questionId: string;
  questionName: string;
  questionTitle: string;
  inputType: string;
  value: unknown;
};
type DraftRecord = {
  _id: mongoose.Types.ObjectId;
  answers: DraftAnswer[];
  submittedAt?: Date | null;
  updatedAt: Date;
};
type DraftOwner = { formId: string; organizationId: string; userId: string };

const idSchema = z.string().refine(mongoose.isValidObjectId, "A valid ID is required.");
const activeDraft = { submittedAt: null };
const saveSchema = z.strictObject({
  formAnswers: z.record(z.string(), z.union([
    z.string(), z.number().finite(), z.boolean(), z.array(z.string()), z.null(),
  ])),
});

function isDuplicateKey(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

function isStoredFile(value: unknown): value is StoredFileMetadata {
  return typeof value === "object" && value !== null &&
    "id" in value && typeof value.id === "string" &&
    "url" in value && typeof value.url === "string";
}

function filesIn(answers: DraftAnswer[]) {
  return answers.filter((answer) => answer.inputType === "file")
    .flatMap((answer) => Array.isArray(answer.value)
      ? answer.value.filter(isStoredFile).map((file) => ({ questionId: answer.questionId, file }))
      : []);
}

function toDraftData(draft: DraftRecord) {
  return {
    id: String(draft._id),
    formAnswers: Object.fromEntries(draft.answers
      .filter((answer) => answer.inputType !== "file")
      .map((answer) => [answer.questionId, answer.value])),
    files: filesIn(draft.answers).map(({ questionId, file }) => ({
      questionId,
      id: file.id,
      name: file.originalName,
      url: file.url,
      mimeType: file.mimeType,
      size: file.size,
    })),
    updatedAt: draft.updatedAt,
  };
}

function assertOpen(form: DraftForm) {
  if (form.isClosed) {
    throw new AppError("This form is closed.", { statusCode: 409, code: "FORM_CLOSED" });
  }
}

function visibleQuestions(form: DraftForm) {
  return form.sections.filter((section) => !section.isHidden)
    .flatMap((section) => section.questions.map((question) => ({ section, question })));
}

function makeAnswer(
  section: SubmissionSection,
  question: SubmissionSection["questions"][number],
  value: unknown,
): DraftAnswer {
  return {
    sectionId: section._id,
    sectionTitle: section.title,
    questionId: question._id,
    questionName: question.name,
    questionTitle: question.title,
    inputType: question.inputType,
    value,
  };
}

function savedAnswers(form: DraftForm, values: Record<string, unknown>, previous: DraftAnswer[]) {
  const questions = visibleQuestions(form);
  const allowed = new Map(questions.map(({ question }) => [question._id, question]));
  for (const questionId of Object.keys(values)) {
    const question = allowed.get(questionId);
    if (!question || question.inputType === "file") {
      throw badRequest("A draft answer does not belong to a visible non-file question.", { questionId });
    }
  }
  const nonFileAnswers = questions.filter(({ question }) => question.inputType !== "file")
    .filter(({ question }) => {
      const value = values[question._id];
      return value !== undefined && value !== null && value !== "" &&
        (!Array.isArray(value) || value.length > 0);
    })
    .map(({ section, question }) => makeAnswer(section, question, values[question._id]));
  return [...nonFileAnswers, ...previous.filter((answer) => answer.inputType === "file")];
}

async function loadForm(owner: DraftOwner) {
  const formId = idSchema.safeParse(owner.formId);
  if (!formId.success) throw badRequest("A valid form ID is required.");
  const form = await Form.findOne({
    _id: formId.data,
    organizationId: owner.organizationId,
    type: { $in: ["AUTHENTICATED", null] },
    archivedAt: null,
  }).select("organizationId name sections isClosed").lean() as DraftForm | null;
  if (!form) throw notFound("Form");
  return form;
}

function ownerQuery(owner: DraftOwner, form: DraftForm) {
  return {
    formId: form._id,
    organizationId: form.organizationId,
    submittedBy: owner.userId,
  };
}

async function loadDraft(owner: DraftOwner, form: DraftForm, draftId: string) {
  const parsed = idSchema.safeParse(draftId);
  if (!parsed.success) throw badRequest("A valid draft ID is required.");
  const draft = await FormSubmission.findOne({
    _id: parsed.data,
    ...ownerQuery(owner, form),
    ...activeDraft,
  }).lean() as DraftRecord | null;
  if (!draft) throw notFound("Draft");
  return draft;
}

export async function openDraft(owner: DraftOwner) {
  const form = await loadForm(owner);
  assertOpen(form);
  const query = { ...ownerQuery(owner, form), ...activeDraft };
  let draft;
  try {
    draft = await FormSubmission.findOneAndUpdate(query, {
      $setOnInsert: { formName: form.name, answers: [], submittedAt: null },
    }, { upsert: true, returnDocument: "after", runValidators: true });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    draft = await FormSubmission.findOne(query);
  }
  if (!draft) throw conflict("Could not open this draft. Try again.");
  return toDraftData(draft);
}

export async function currentDraft(owner: DraftOwner) {
  const form = await loadForm(owner);
  const draft = await FormSubmission.findOne({
    ...ownerQuery(owner, form), ...activeDraft,
  }).lean() as DraftRecord | null;
  return draft ? toDraftData(draft) : null;
}

export async function getDraft(owner: DraftOwner, draftId: string) {
  const form = await loadForm(owner);
  return toDraftData(await loadDraft(owner, form, draftId));
}

export async function saveDraft(owner: DraftOwner, draftId: string, body: unknown) {
  const form = await loadForm(owner);
  assertOpen(form);
  const input = saveSchema.safeParse(body);
  if (!input.success) throw badRequest("Send formAnswers for the draft.");
  const draft = await loadDraft(owner, form, draftId);
  const answers = savedAnswers(form, input.data.formAnswers, draft.answers);
  const updated = await FormSubmission.findOneAndUpdate({
    _id: draft._id, ...ownerQuery(owner, form), ...activeDraft,
    answers: draft.answers,
  }, { $set: { answers } }, { returnDocument: "after", runValidators: true });
  if (!updated) throw conflict("This submission changed elsewhere. Reload it before saving.");
  return toDraftData(updated);
}

export async function addDraftFile(owner: DraftOwner, draftId: string, questionId: string, request: Request) {
  let uploaded: StoredFileMetadata | undefined;
  try {
    const form = await loadForm(owner);
    assertOpen(form);
    const draft = await loadDraft(owner, form, draftId);
    if (filesIn(draft.answers).length >= 10) throw badRequest("A draft can contain at most 10 files.");
    const parsedQuestionId = z.string().min(1).max(128).safeParse(questionId);
    if (!parsedQuestionId.success) throw badRequest("A valid question ID is required.");
    const match = visibleQuestions(form)
      .find(({ question }) => question._id === parsedQuestionId.data && question.inputType === "file");
    if (!match) throw notFound("File question");
    uploaded = await uploadQuestionFile({ request, form, questionId: parsedQuestionId.data });
    const existingFiles = filesIn(draft.answers)
      .filter((entry) => entry.questionId === questionId).map((entry) => entry.file);
    const answers = [
      ...draft.answers.filter((answer) => answer.questionId !== questionId),
      makeAnswer(match.section, match.question, [...existingFiles, uploaded]),
    ];
    const updated = await FormSubmission.findOneAndUpdate({
      _id: draft._id, ...ownerQuery(owner, form), ...activeDraft,
      answers: draft.answers,
    }, { $set: { answers } }, { returnDocument: "after", runValidators: true });
    if (!updated) throw conflict("This submission changed elsewhere. Reload it before uploading.");
    uploaded = undefined;
    return toDraftData(updated);
  } catch (error) {
    if (uploaded) await storageProvider.delete(uploaded).catch((cleanupError: unknown) => {
      Logger.warn("Could not clean up an unattached draft file", cleanupError);
    });
    throw error;
  }
}

export async function removeDraftFile(owner: DraftOwner, draftId: string, fileId: string) {
  const form = await loadForm(owner);
  const draft = await loadDraft(owner, form, draftId);
  const entry = filesIn(draft.answers).find(({ file }) => file.id === fileId);
  if (!entry) throw notFound("Draft file");
  const answers = draft.answers.flatMap((answer) => {
    if (answer.questionId !== entry.questionId || answer.inputType !== "file") return [answer];
    const files = Array.isArray(answer.value)
      ? answer.value.filter((file) => !isStoredFile(file) || file.id !== entry.file.id)
      : [];
    return files.length ? [{ ...answer, value: files }] : [];
  });
  const updated = await FormSubmission.findOneAndUpdate({
    _id: draft._id, ...ownerQuery(owner, form), ...activeDraft,
    answers: draft.answers,
  }, { $set: { answers } }, { returnDocument: "after", runValidators: true });
  if (!updated) throw conflict("This submission changed elsewhere. Reload it before removing a file.");
  await storageProvider.delete(entry.file).catch((cleanupError: unknown) => {
    Logger.warn("Could not clean up a removed draft file", cleanupError);
  });
  return toDraftData(updated);
}

export async function submitDraft(owner: DraftOwner, draftId: string) {
  const form = await loadForm(owner);
  const parsed = idSchema.safeParse(draftId);
  if (!parsed.success) throw badRequest("A valid draft ID is required.");
  const query = { _id: parsed.data, ...ownerQuery(owner, form) };
  const existing = await FormSubmission.findOne(query).lean() as DraftRecord | null;
  if (!existing) throw notFound("Draft");
  if (existing.submittedAt) return { id: String(existing._id), submittedAt: existing.submittedAt, replayed: true };
  assertOpen(form);

  const uploadedFiles: Record<string, StoredFileMetadata[]> = {};
  const fileQuestions = new Map(visibleQuestions(form)
    .filter(({ question }) => question.inputType === "file")
    .map(({ question }) => [question._id, question]));
  for (const { questionId, file } of filesIn(existing.answers)) {
    const question = fileQuestions.get(questionId);
    if (!question) throw badRequest("A saved file no longer belongs to this form.", { questionId });
    const category = question.typeConfig?.uploadCategory ?? "all";
    const extension = normalizeUploadExtension(file.extension);
    if (!isUploadExtensionInCategory(category, extension) ||
      (category !== "all" && question.typeConfig?.allowedExtensions?.length &&
        !question.typeConfig.allowedExtensions.includes(extension))) {
      throw badRequest("A saved file is no longer allowed for this question.", { questionId });
    }
    (uploadedFiles[questionId] ??= []).push(file);
  }
  const formAnswers = Object.fromEntries(existing.answers
    .filter((answer) => answer.inputType !== "file")
    .map((answer) => [answer.questionId, answer.value]));
  const answers = validateFormAnswers(form.sections, formAnswers, uploadedFiles);
  const updated = await FormSubmission.findOneAndUpdate({
    ...query, ...activeDraft, answers: existing.answers,
  }, {
    $set: { answers, submittedAt: new Date() },
  }, { returnDocument: "after", runValidators: true });
  if (!updated) {
    const latest = await FormSubmission.findOne(query).select("_id submittedAt").lean();
    if (!latest?.submittedAt) throw conflict("This submission changed while submitting. Try again.");
    return { id: String(latest._id), submittedAt: latest.submittedAt, replayed: true };
  }
  return { id: String(updated._id), submittedAt: updated.submittedAt, replayed: false };
}
