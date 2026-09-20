import { Router } from "express";
import { authenticate } from "../../middlewares";
import AuthModule from "../../modules/auth";

const router = Router();

/**
 * GET /me
 */
router.get("/", authenticate, async (req, res, next) => {
  try {
    const user = await AuthModule.services.getCurrentUser(req.auth!.userId);
    return res.status(200).json({ success: true, data: user });
  } catch (error) {
    return next(error);
  }
});

export default router;
