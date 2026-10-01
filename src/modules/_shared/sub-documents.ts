import mongoose from "mongoose";
import { UPLOAD_CATEGORIES } from "#app/modules/file-upload/policy";

export const FORM_FIELD_TYPES = [
  "string",
  "text",
  "email",
  "number",
  "select",
  "radio",
  "multi-select",
  "checkboxes",
  "boolean",
  "datetime",
  "countries",
  "file",
  "linear-scale",
] as const;

const FormOptionSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    value: { type: String, required: true },
    isCorrectAnswer: { type: Boolean, default: false },
  },
  { _id: false },
);

export const FormQuestionSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    placeholder: { type: String, default: "" },
    inputType: { type: String, required: true, enum: FORM_FIELD_TYPES },
    isRequired: { type: Boolean, default: false },
    options: { type: [FormOptionSchema], default: undefined },
    typeConfig: {
      type: String,
      format: String,
      min: Number,
      max: Number,
      minLabel: String,
      maxLabel: String,
      uploadCategory: { type: String, enum: UPLOAD_CATEGORIES },
      allowedExtensions: { type: [String], default: undefined },
    },
    validation: {
      minLength: Number,
      maxLength: Number,
      min: Number,
      max: Number,
      regex: String,
    },
    defaultValue: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { _id: false },
);

export const FormSectionSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    isHidden: { type: Boolean, default: false },
    questions: { type: [FormQuestionSchema], default: [] },
  },
  { _id: false },
);
