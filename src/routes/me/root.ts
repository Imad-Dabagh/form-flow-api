import { Router } from "express";
import { authenticate } from "../../middlewares/index.js";
import Membership from "../../modules/membership/models/index.js";
import User from "../../modules/user/models/index.js";
import { badRequest, unauthenticated } from "../../utils/errors.js";
import { getBody, optionalHttpsUrl } from "../../utils/request-values.js";

const router = Router();
const editableProfileFields = new Set([
  "firstName",
  "lastName",
  "profilePic",
  "coverPhoto",
  "phone",
  "shortDescription",
]);

function requiredName(body: Record<string, unknown>, field: string): string {
  const value = body[field];

  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${field} is required.`);
  }

  const name = value.trim();

  if (name.length > 50) {
    throw badRequest(`${field} must be 50 characters or fewer.`);
  }

  return name;
}

function optionalText(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw badRequest(`${field} must be a string.`);
  }

  const text = value.trim();
  if (text.length > maxLength) {
    throw badRequest(`${field} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

function toProfileResponse(
  user: {
    _id: unknown;
    email: string;
    firstName?: string;
    lastName?: string;
    profilePic?: string;
    coverPhoto?: string;
    phone?: string;
    shortDescription?: string;
    onboardingCompletedAt?: Date | null;
  },
  auth: { isEmailVerified: boolean; isSuperAdmin: boolean },
) {
  return {
    id: String(user._id),
    email: user.email,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    profilePic: user.profilePic ?? "",
    coverPhoto: user.coverPhoto ?? "",
    phone: user.phone ?? "",
    shortDescription: user.shortDescription ?? "",
    onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null,
    isEmailVerified: auth.isEmailVerified,
    isSuperAdmin: auth.isSuperAdmin,
  };
}

/**
 * GET /api/me
 */
router.get("/", authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.auth!.userId);

    if (!user) {
      throw unauthenticated();
    }

    return res.status(200).json({
      success: true,
      data: toProfileResponse(user, req.auth!),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * PUT /api/me
 */
router.put("/", authenticate, async (req, res, next) => {
  try {
    const body = getBody(req);
    if (Object.keys(body).some((field) => !editableProfileFields.has(field))) {
      throw badRequest("Only firstName, lastName, profilePic, coverPhoto, phone, and shortDescription can be updated.");
    }
    const firstName = requiredName(body, "firstName");
    const lastName = requiredName(body, "lastName");
    const profilePic = optionalHttpsUrl(body, "profilePic");
    const coverPhoto = optionalHttpsUrl(body, "coverPhoto");
    const phone = optionalText(body, "phone", 30);
    const shortDescription = optionalText(body, "shortDescription", 500);
    const user = await User.findById(req.auth!.userId);

    if (!user) {
      throw unauthenticated();
    }

    user.firstName = firstName;
    user.lastName = lastName;
    if (profilePic !== undefined) {
      user.profilePic = profilePic;
    }
    if (coverPhoto !== undefined) {
      user.coverPhoto = coverPhoto;
    }
    if (phone !== undefined) {
      user.phone = phone;
    }
    if (shortDescription !== undefined) {
      user.shortDescription = shortDescription;
    }
    const hasOrganization = await Membership.exists({
      userId: req.auth!.userId,
    });

    if (hasOrganization) {
      user.onboardingCompletedAt ??= new Date();
    }

    await user.save();

    return res.status(200).json({
      success: true,
      data: toProfileResponse(user, req.auth!),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
