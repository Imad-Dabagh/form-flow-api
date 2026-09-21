import { Router } from "express";
import { authenticate } from "../../middlewares/index.js";
import User from "../../modules/user/models/index.js";
import { badRequest, conflict, unauthenticated } from "../../utils/errors.js";

const router = Router();
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/;

function getBody(req: { body: unknown }): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw badRequest("A JSON object is required.");
  }

  return req.body as Record<string, unknown>;
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
      data: {
        id: String(user._id),
        email: user.email,
        username: user.username ?? null,
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        profilePic: user.profilePic ?? "",
        isEmailVerified: req.auth!.isEmailVerified,
        platformRoles: user.platformRoles ?? [],
        onboardingRequired: !user.username,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/me/onboarding
 */
router.post("/onboarding", authenticate, async (req, res, next) => {
  try {
    const body = getBody(req);
    const rawUsername = body.username;

    if (typeof rawUsername !== "string" || !rawUsername.trim()) {
      throw badRequest("username is required.");
    }

    const username = rawUsername.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      throw badRequest("username must be 3 to 32 letters, numbers, or underscores.");
    }

    const user = await User.findById(req.auth!.userId).select("username");
    if (!user) {
      throw unauthenticated();
    }

    if (user.username) {
      if (user.username === username) {
        return res.status(200).json({ success: true, data: { username } });
      }

      throw conflict("Onboarding has already been completed.");
    }

    user.username = username;
    await user.save();

    return res.status(200).json({ success: true, data: { username } });
  } catch (error) {
    return next(error);
  }
});

export default router;
