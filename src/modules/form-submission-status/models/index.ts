import mongoose from "mongoose";
import { COLOR_FAMILIES } from "#app/modules/_shared/constants";

const formSubmissionStatusSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    formId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Form",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: 500,
    },
    color: {
      type: String,
      required: true,
      trim: true,
      enum: Object.values(COLOR_FAMILIES),
    },
    order: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isInteger,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    isSubmissionLocked: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

formSubmissionStatusSchema.index({ organizationId: 1, formId: 1, order: 1 });

const FormSubmissionStatus = mongoose.models.FormSubmissionStatus
  ?? mongoose.model("FormSubmissionStatus", formSubmissionStatusSchema);

export default FormSubmissionStatus;
