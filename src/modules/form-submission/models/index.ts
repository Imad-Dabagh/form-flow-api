import mongoose from "mongoose";
import { SUB_DOCUMENTS } from "#app/modules/_shared/index";

const { FormSubmissionAnswerSchema } = SUB_DOCUMENTS;

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
    formName: { type: String, required: true },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    idempotencyKey: { type: String },
    submittedAt: { type: Date, default: null },
    answers: { type: [FormSubmissionAnswerSchema], required: true },
  },
  { timestamps: true },
);

formSubmissionSchema.index({ formId: 1, submittedAt: -1, _id: -1 });
formSubmissionSchema.index({ formId: 1, submittedBy: 1, createdAt: -1 });
formSubmissionSchema.index({ organizationId: 1, createdAt: -1, _id: -1 });
formSubmissionSchema.index({ formId: 1, submittedBy: 1 }, {
  unique: true,
  partialFilterExpression: {
    submittedBy: { $type: "objectId" },
    submittedAt: { $type: "null" },
  },
});
formSubmissionSchema.index({ formId: 1, idempotencyKey: 1 }, {
  unique: true,
  partialFilterExpression: { idempotencyKey: { $type: "string" } },
});

const FormSubmission = mongoose.models.FormSubmission
  ?? mongoose.model("FormSubmission", formSubmissionSchema);

export default FormSubmission;
