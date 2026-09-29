import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { authenticate, resolveUploadTenant } from "../../middlewares/index.js";
import { receiveFileUpload } from "../../modules/file-upload/index.js";
import { storageProvider } from "../../services/index.js";
import { tooManyRequests } from "../../utils/errors.js";

const router = Router();
const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  identifier: "file-upload",
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.auth!.userId,
  handler: (_req, _res, next) =>
    next(tooManyRequests("Upload limit reached. Try again later.")),
});

/**
 * POST /api/upload
 */
router.post(
  "/",
  authenticate,
  uploadRateLimit,
  resolveUploadTenant,
  async (req, res, next) => {
    try {
      const file = await receiveFileUpload(req, {
        tenantId: req.uploadTenantId!,
        storage: storageProvider,
      });

      return res.status(201).json({ success: true, data: file });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
