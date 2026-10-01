import { z } from "zod";
import { FORM_FIELD_TYPES } from "#app/modules/_shared/sub-documents";
import {
  isUploadExtensionInCategory,
  normalizeUploadExtension,
  UPLOAD_CATEGORIES,
} from "#app/modules/file-upload/policy";

const nonEmpty = z.string().trim().min(1);
const choiceTypes = new Set(["select", "radio", "multi-select", "checkboxes"]);

const optionSchema = z.strictObject({
  label: nonEmpty,
  value: nonEmpty,
  isCorrectAnswer: z.boolean().optional(),
});

const questionSchema = z.strictObject({
  _id: nonEmpty,
  name: nonEmpty,
  title: nonEmpty,
  description: z.string().optional(),
  placeholder: z.string().optional(),
  inputType: z.enum(FORM_FIELD_TYPES),
  isRequired: z.boolean().optional(),
  options: z.array(optionSchema).optional(),
  typeConfig: z.strictObject({
    type: z.enum(["date", "time"]).optional(),
    format: z.string().optional(),
    min: z.number().int().optional(),
    max: z.number().int().optional(),
    minLabel: z.string().optional(),
    maxLabel: z.string().optional(),
    uploadCategory: z.enum(UPLOAD_CATEGORIES).optional(),
    allowedExtensions: z.array(z.string().regex(/^[a-z0-9]+$/)).optional(),
  }).optional(),
  validation: z.strictObject({
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    regex: z.string().optional(),
  }).optional(),
  defaultValue: z.unknown().optional(),
}).superRefine((question, context) => {
  if (choiceTypes.has(question.inputType) && !question.options?.length) {
    context.addIssue({ code: "custom", path: ["options"], message: "Choice fields require at least one option." });
  }

  if (question.options) {
    const values = question.options.map((option) => option.value);
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: ["options"], message: "Option values must be unique." });
    }
  }

  const { min, max, minLength, maxLength } = question.validation ?? {};
  if (min !== undefined && max !== undefined && min > max) {
    context.addIssue({ code: "custom", path: ["validation"], message: "Minimum cannot exceed maximum." });
  }
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    context.addIssue({ code: "custom", path: ["validation"], message: "Minimum length cannot exceed maximum length." });
  }

  if (question.inputType === "linear-scale") {
    const scaleMin = question.typeConfig?.min ?? 1;
    const scaleMax = question.typeConfig?.max ?? 5;
    if (![0, 1].includes(scaleMin) || scaleMax < 2 || scaleMax > 10 || scaleMin >= scaleMax) {
      context.addIssue({ code: "custom", path: ["typeConfig"], message: "Linear scale must run from 0 or 1 to a value from 2 to 10." });
    }
  }

  const uploadCategory = question.typeConfig?.uploadCategory;
  const allowedExtensions = question.typeConfig?.allowedExtensions;
  if (question.inputType === "file") {
    const category = uploadCategory ?? "all";
    if (allowedExtensions) {
      if ((category === "all" && allowedExtensions.length > 0) ||
        new Set(allowedExtensions).size !== allowedExtensions.length ||
        allowedExtensions.some((extension) => extension !== normalizeUploadExtension(extension) ||
          !isUploadExtensionInCategory(category, extension))) {
        context.addIssue({ code: "custom", path: ["typeConfig", "allowedExtensions"], message: "Choose unique extensions supported by the selected upload category." });
      }
    }
  } else if (uploadCategory !== undefined || allowedExtensions !== undefined) {
    context.addIssue({ code: "custom", path: ["typeConfig"], message: "Upload settings are only available for file questions." });
  }
});

const sectionSchema = z.strictObject({
  _id: nonEmpty,
  title: nonEmpty,
  description: z.string().optional(),
  isHidden: z.boolean().optional(),
  questions: z.array(questionSchema),
});

export const updateFormSchema = z.strictObject({
  name: nonEmpty.max(100),
  description: z.string(),
  sections: z.array(sectionSchema),
  displayMode: z.enum(["SINGLE_PAGE", "WIZARD"]),
  isClosed: z.boolean(),
}).superRefine((body, context) => {
  const sectionIds = new Set<string>();
  const questionIds = new Set<string>();
  const questionNames = new Set<string>();

  body.sections.forEach((section, sectionIndex) => {
    if (sectionIds.has(section._id)) {
      context.addIssue({ code: "custom", path: ["sections", sectionIndex, "_id"], message: "Section IDs must be unique." });
    }
    sectionIds.add(section._id);

    section.questions.forEach((question, questionIndex) => {
      for (const [value, seen, key, message] of [
        [question._id, questionIds, "_id", "Question IDs must be unique."],
        [question.name, questionNames, "name", "Question names must be unique."],
      ] as const) {
        if (seen.has(value)) {
          context.addIssue({ code: "custom", path: ["sections", sectionIndex, "questions", questionIndex, key], message });
        }
        seen.add(value);
      }
    });
  });
});
