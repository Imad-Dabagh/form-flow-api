import { Router } from "express";
import { authenticate } from "../../middlewares";
import User from "../../modules/user/models";
import { unauthenticated } from "../../utils/errors";

const router = Router();

/**
 * GET /me
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
        username: user.username,
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        profilePic: user.profilePic ?? "",
        isEmailVerified: user.isEmailVerified ?? false,
        platformRoles: user.platformRoles ?? [],
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
