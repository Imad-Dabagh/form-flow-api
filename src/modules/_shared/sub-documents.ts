import mongoose from "mongoose";

export const FORM_FIELD_TYPES = [
  "string",
  "text",
  "number",
  "email",
  "file",
  "datetime",
  "countries",
  "select",
  "radio",
  "multi-select",
  "checkboxes",
  "boolean",
  "linear-scale",
] as const;

export const FormFieldSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    inputType: { type: String, required: true, enum: FORM_FIELD_TYPES },
    label: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    placeholder: { type: String, default: "" },
    required: { type: Boolean, default: false },
    typeConfig: {
      type: { type: String },
      format: { type: String },
      min: { type: Number, default: 1 },
      max: { type: Number, default: 5 },
      minLabel: { type: String, default: "" },
      maxLabel: { type: String, default: "" },
    },
    options: [
      {
        label: String,
        value: String,
      },
    ],
    validation: {
      minLength: Number,
      maxLength: Number,
      min: Number,
      max: Number,
      pattern: String,
    },
    defaultValue: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { _id: false },
);

export const FormSectionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    title: { type: String, default: "", trim: true },
    description: { type: String, default: "" },
    fields: { type: [FormFieldSchema], default: [] },
  },
  { _id: false },
);
