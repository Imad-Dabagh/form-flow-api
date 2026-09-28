import mongoose from "mongoose";
import { ORGANIZATION_ROLES } from "../../_shared/constants.js";

const invitationSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: {
      type: String,
      enum: [ORGANIZATION_ROLES.ADMIN, ORGANIZATION_ROLES.MANAGER],
      required: true,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "CANCELLED", "EXPIRED"],
      default: "PENDING",
      required: true,
    },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

invitationSchema.index(
  { organizationId: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: "PENDING" } },
);
invitationSchema.index({ email: 1, status: 1, expiresAt: 1 });

const Invitation =
  mongoose.models.Invitation ?? mongoose.model("Invitation", invitationSchema);

export default Invitation;
