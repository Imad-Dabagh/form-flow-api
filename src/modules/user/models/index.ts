import mongoose from "mongoose";
import { PLATFORM_ROLES } from "../../_shared/constants.js";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    authUserId: {
      type: String,
      required: true,
      trim: true,
    },
    firstName: {
      type: String,
      trim: true,
      default: "",
    },
    lastName: {
      type: String,
      trim: true,
      default: "",
    },
    profilePic: {
      type: String,
      trim: true,
      default: "",
    },
    coverPhoto: {
      type: String,
      trim: true,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    gender: {
      type: String,
      enum: ["male", "female", ""],
      trim: true,
      default: "",
    },
    birthDay: { type: Date },
    shortDescription: {
      type: String,
      trim: true,
      default: "",
    },
    platformRoles: {
      type: [String],
      enum: Object.values(PLATFORM_ROLES),
      default: [],
    },
  },
  { timestamps: true },
);

// One global identity can hold memberships in many organizations.
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ authUserId: 1 }, { unique: true });

const User = mongoose.models.User ?? mongoose.model("User", userSchema);

export default User;
