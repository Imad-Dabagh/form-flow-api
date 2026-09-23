import mongoose from "mongoose";

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
  },
  { timestamps: true },
);

// One global identity can hold memberships in many organizations.
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ authUserId: 1 }, { unique: true });

const User = mongoose.models.User ?? mongoose.model("User", userSchema);

export default User;
