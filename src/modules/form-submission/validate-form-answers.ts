import { z } from "zod";
import { badRequest } from "#app/utils/errors";
import type { StoredFileMetadata } from "#app/services/storage/index";
import type { UploadCategory } from "#app/modules/file-upload/policy";

export interface SubmissionQuestion {
  _id: string;
  name: string;
  title: string;
  inputType: string;
  isRequired?: boolean;
  options?: Array<{ value: string; label: string }>;
  typeConfig?: {
    type?: string;
    min?: number;
    max?: number;
    uploadCategory?: UploadCategory;
    allowedExtensions?: string[];
  };
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
  };
}

export interface SubmissionSection {
  _id: string;
  title: string;
  isHidden?: boolean;
  questions: SubmissionQuestion[];
}

export interface ValidatedAnswer {
  sectionId: string;
  sectionTitle: string;
  questionId: string;
  questionName: string;
  questionTitle: string;
  inputType: string;
  value: string | number | boolean | string[] | StoredFileMetadata[];
  selectedOptions?: Array<{ value: string; label: string }>;
}

type NonFileAnswer = string | number | boolean | string[];

const textTypes = new Set(["string", "text", "email", "countries"]);
const singleChoiceTypes = new Set(["select", "radio"]);
const multipleChoiceTypes = new Set(["multi-select", "checkboxes"]);
const emailSchema = z.email();

function invalid(question: SubmissionQuestion, message: string): never {
  throw badRequest(`${question.title}: ${message}`, { questionId: question._id });
}

function validateValue(question: SubmissionQuestion, value: unknown): NonFileAnswer {
  const { inputType, validation } = question;

  if (textTypes.has(inputType)) {
    if (typeof value !== "string") invalid(question, "Enter valid text.");
    if (validation?.minLength !== undefined && value.length < validation.minLength) {
      invalid(question, `Enter at least ${validation.minLength} characters.`);
    }
    if (validation?.maxLength !== undefined && value.length > validation.maxLength) {
      invalid(question, `Enter at most ${validation.maxLength} characters.`);
    }
    if (inputType === "email" && !emailSchema.safeParse(value).success) {
      invalid(question, "Enter a valid email address.");
    }
    return value;
  }

  if (inputType === "number") {
    const number = typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
    if (!Number.isFinite(number)) invalid(question, "Enter a valid number.");
    if (validation?.min !== undefined && number < validation.min) {
      invalid(question, `Enter a number of at least ${validation.min}.`);
    }
    if (validation?.max !== undefined && number > validation.max) {
      invalid(question, `Enter a number of at most ${validation.max}.`);
    }
    return number;
  }

  if (singleChoiceTypes.has(inputType)) {
    if (typeof value !== "string" || !question.options?.some((option) => option.value === value)) {
      invalid(question, "Choose an available option.");
    }
    return value;
  }

  if (multipleChoiceTypes.has(inputType)) {
    if (!Array.isArray(value) ||
      value.some((item) => typeof item !== "string") ||
      new Set(value).size !== value.length ||
      value.some((item) => !question.options?.some((option) => option.value === item))) {
      invalid(question, "Choose available options without duplicates.");
    }
    return value;
  }

  if (inputType === "boolean") {
    if (typeof value !== "boolean") invalid(question, "Enter a valid answer.");
    return value;
  }

  if (inputType === "datetime") {
    if (typeof value !== "string") invalid(question, "Enter a valid date or time.");
    let valid: boolean;
    if (question.typeConfig?.type === "time") {
      valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    } else {
      const date = new Date(`${value}T00:00:00Z`);
      valid = /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }
    if (!valid) invalid(question, "Enter a valid date or time.");
    return value;
  }

  if (inputType === "linear-scale") {
    const number = typeof value === "number" ? value : NaN;
    const min = question.typeConfig?.min ?? 1;
    const max = question.typeConfig?.max ?? 5;
    if (!Number.isInteger(number) || number < min || number > max) {
      invalid(question, "Choose a value on the scale.");
    }
    return number;
  }

  invalid(question, "This question type cannot be submitted yet.");
}

/** Accept only answers to visible questions, in the form's current order. */
export function validateFormAnswers(
  sections: SubmissionSection[],
  formAnswers: Record<string, unknown>,
  uploadedFiles: Record<string, StoredFileMetadata[]> = {},
  allowMissingFiles = false,
): ValidatedAnswer[] {
  const visibleSections = sections.filter((section) => !section.isHidden);
  const questions = visibleSections.flatMap((section) => section.questions);
  if (questions.length === 0) throw badRequest("This form has no questions to submit.");

  const allowedIds = new Set(questions.map((question) => question._id));
  if (Object.keys(formAnswers).some((id) => !allowedIds.has(id))) {
    throw badRequest("An answer does not belong to this form.");
  }

  const answers: ValidatedAnswer[] = [];
  for (const section of visibleSections) {
    for (const question of section.questions) {
      if (question.inputType === "file") {
        if (Object.prototype.hasOwnProperty.call(formAnswers, question._id)) {
          invalid(question, "Send files as uploads, not answer values.");
        }
        const files = uploadedFiles[question._id] ?? [];
        if (!files.length) {
          if (question.isRequired && !allowMissingFiles) invalid(question, "An answer is required.");
          continue;
        }
        answers.push({
          sectionId: section._id,
          sectionTitle: section.title,
          questionId: question._id,
          questionName: question.name,
          questionTitle: question.title,
          inputType: question.inputType,
          value: files,
        });
        continue;
      }
      const rawValue = Object.prototype.hasOwnProperty.call(formAnswers, question._id)
        ? formAnswers[question._id]
        : undefined;
      const isEmpty = rawValue === undefined || rawValue === null ||
        (typeof rawValue === "string" && rawValue.trim() === "") ||
        (Array.isArray(rawValue) && rawValue.length === 0);
      if (isEmpty) {
        if (question.isRequired) invalid(question, "An answer is required.");
        continue;
      }
      if (question.inputType === "boolean" && question.isRequired && rawValue !== true) {
        invalid(question, "This must be checked.");
      }
      const value = validateValue(question, rawValue);
      const selectedValues = Array.isArray(value)
        ? value
        : singleChoiceTypes.has(question.inputType) ? [String(value)] : [];
      const selectedOptions = selectedValues.length
        ? question.options?.filter((option) => selectedValues.includes(option.value))
          .map((option) => ({ value: option.value, label: option.label }))
        : undefined;

      answers.push({
        sectionId: section._id,
        sectionTitle: section.title,
        questionId: question._id,
        questionName: question.name,
        questionTitle: question.title,
        inputType: question.inputType,
        value,
        ...(selectedOptions?.length ? { selectedOptions } : {}),
      });
    }
  }

  return answers;
}
