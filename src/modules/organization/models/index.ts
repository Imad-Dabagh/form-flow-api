import mongoose from "mongoose";
import { COLOR_FAMILIES } from "#app/modules/_shared/constants";

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    slogan: {
      type: String,
      trim: true,
      default: "",
    },
    logo: {
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
    shortDescription: {
      type: String,
      trim: true,
      default: "",
    },
    primaryColor: {
      type: String,
      enum: Object.values(COLOR_FAMILIES),
      default: COLOR_FAMILIES.BLUE,
    },
    isDisabled: {
      type: Boolean,
      default: false,
    },
    membershipRevision: {
      type: Number,
      default: 0,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// A slug is the public URL identifier and must be unique across the platform.
organizationSchema.index({ slug: 1 }, { unique: true });

const Organization = mongoose.models.Organization ?? mongoose.model("Organization", organizationSchema);

export default Organization;
