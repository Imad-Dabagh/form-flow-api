import { Router } from "express";
import { authenticate, resolveUploadTenant } from "#app/middlewares/index";
import { receiveFileUpload } from "#app/modules/file-upload/index";
import { authenticatedUploadRateLimit } from "#app/modules/file-upload/authenticated-rate-limit";
import { storageProvider } from "#app/services/index";

const router = Router();

/**
 * POST /api/upload
 */
router.post(
  "/",
  authenticate,
  authenticatedUploadRateLimit,
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
