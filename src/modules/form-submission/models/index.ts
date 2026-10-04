import mongoose from "mongoose";

const formSubmissionSchema = new mongoose.Schema(
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
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    idempotencyKey: { type: String },
    submittedAt: { type: Date, default: null },
    answers: { type: mongoose.Schema.Types.Mixed, required: true, default: () => ({}) },
  },
  { timestamps: true, minimize: false },
);

formSubmissionSchema.index({ formId: 1, submittedAt: -1, _id: -1 });
formSubmissionSchema.index({ formId: 1, submittedBy: 1 }, {
  unique: true,
  partialFilterExpression: { submittedBy: { $type: "objectId" } },
});
formSubmissionSchema.index({ formId: 1, idempotencyKey: 1 }, {
  unique: true,
  partialFilterExpression: { idempotencyKey: { $type: "string" } },
});

const FormSubmission = mongoose.models.FormSubmission
  ?? mongoose.model("FormSubmission", formSubmissionSchema);

export default FormSubmission;
