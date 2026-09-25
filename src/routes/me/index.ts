import { Router } from "express";
import { authenticate } from "../../middlewares/index.js";
import Membership from "../../modules/membership/models/index.js";
import User from "../../modules/user/models/index.js";
import { badRequest, unauthenticated } from "../../utils/errors.js";

const router = Router();

function getBody(req: { body: unknown }): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw badRequest("A JSON object is required.");
  }

  return req.body as Record<string, unknown>;
}

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

function toProfileResponse(
  user: {
    _id: unknown;
    email: string;
    firstName?: string;
    lastName?: string;
    profilePic?: string;
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
 * PATCH /api/me
 */
router.patch("/", authenticate, async (req, res, next) => {
  try {
    const body = getBody(req);
    const firstName = requiredName(body, "firstName");
    const lastName = requiredName(body, "lastName");
    const user = await User.findById(req.auth!.userId);

    if (!user) {
      throw unauthenticated();
    }

    user.firstName = firstName;
    user.lastName = lastName;
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
