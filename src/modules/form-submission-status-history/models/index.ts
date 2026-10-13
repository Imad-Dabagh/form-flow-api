import mongoose from "mongoose";

const formSubmissionStatusHistorySchema = new mongoose.Schema(
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
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FormSubmission",
      required: true,
    },
    fromStatusId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FormSubmissionStatus",
      required: true,
    },
    toStatusId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FormSubmissionStatus",
      required: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

formSubmissionStatusHistorySchema.index({
  organizationId: 1,
  formId: 1,
  submissionId: 1,
  createdAt: -1,
  _id: -1,
});

const FormSubmissionStatusHistory =
  mongoose.models.FormSubmissionStatusHistory ??
  mongoose.model("FormSubmissionStatusHistory", formSubmissionStatusHistorySchema);

export default FormSubmissionStatusHistory;
