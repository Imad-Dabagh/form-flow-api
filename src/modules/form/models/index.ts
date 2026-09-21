import mongoose from "mongoose";
import { SUB_DOCUMENTS } from "../../_shared/index.js";

const { FormSectionSchema } = SUB_DOCUMENTS;

const formSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    sections: {
      type: [FormSectionSchema],
      default: [],
    },
    displayMode: {
      type: String,
      enum: ["SINGLE_PAGE", "WIZARD"],
      default: "SINGLE_PAGE",
    },
    isClosed: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

formSchema.index({ organizationId: 1, archivedAt: 1 });

const Form = mongoose.models.Form ?? mongoose.model("Form", formSchema);

export default Form;
