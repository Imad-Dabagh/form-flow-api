import { Router } from "express";
import { authenticate } from "../../middlewares/index.js";
import User from "../../modules/user/models/index.js";
import { unauthenticated } from "../../utils/errors.js";

const router = Router();

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
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        profilePic: user.profilePic ?? "",
        isEmailVerified: req.auth!.isEmailVerified,
        isSuperAdmin: req.auth!.isSuperAdmin,
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
