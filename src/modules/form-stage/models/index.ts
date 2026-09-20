import mongoose from "mongoose";

const formStageSchema = new mongoose.Schema(
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
    label: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    color: {
      type: String,
      trim: true,
      default: "",
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    stageOrder: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true },
);

// A form has one stage at each position and at most one default stage.
formStageSchema.index({ formId: 1, stageOrder: 1 }, { unique: true });
formStageSchema.index(
  { formId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } },
);
formStageSchema.index({ organizationId: 1, formId: 1 });

const FormStage = mongoose.models.FormStage ?? mongoose.model("FormStage", formStageSchema);

export default FormStage;
