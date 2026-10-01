import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { validate } from "#app/middlewares/index";
import Form from "#app/modules/form/models/index";
import { toSubmissionFormPresentation } from "#app/modules/form/submission-form-presentation";
import { notFound } from "#app/utils/errors";

const router = Router({ mergeParams: true });

/** GET /api/orgs/:organizationSlug/forms/:formId/response */
router.get(
  "/",
  validate({
    params: z.object({
      organizationSlug: z.string(),
      formId: z.string().refine(mongoose.isValidObjectId, "A valid form ID is required."),
    }),
  }),
  async (req, res, next) => {
    try {
      const form = await Form.findOne({
        _id: req.params.formId,
        organizationId: req.organizationAccess!.organizationId,
        type: { $in: ["AUTHENTICATED", null] },
        archivedAt: null,
      }).select("name type description sections displayMode isClosed").lean();
      if (!form) throw notFound("Form");

      res.set("Cache-Control", "no-store");
      return res.status(200).json({
        success: true,
        data: toSubmissionFormPresentation(form),
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
