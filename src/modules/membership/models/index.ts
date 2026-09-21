import mongoose from "mongoose";
import { ORGANIZATION_ROLES } from "../../_shared/constants.js";

const membershipSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    role: {
      type: String,
      enum: Object.values(ORGANIZATION_ROLES),
      required: true,
    },
  },
  { timestamps: true },
);

membershipSchema.index({ userId: 1, organizationId: 1 }, { unique: true });
membershipSchema.index({ organizationId: 1, role: 1 });

const Membership = mongoose.models.Membership ?? mongoose.model("Membership", membershipSchema);

export default Membership;
