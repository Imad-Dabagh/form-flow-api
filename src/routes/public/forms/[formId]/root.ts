import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { validate } from "#app/middlewares/index";
import FormModule from "#app/modules/form/index";
import { toSubmissionFormPresentation } from "#app/modules/form/submission-form-presentation";
import { notFound } from "#app/utils/errors";

const router = Router({ mergeParams: true });

/** GET /api/public/forms/:formId */
router.get<{ formId: string }>(
  "/",
  validate({
    params: z.object({
      formId: z.string().refine(mongoose.isValidObjectId, "A valid form ID is required."),
    }),
  }),
  async (req, res, next) => {
    try {
      const form = (await FormModule.services.fetchById({
        id: req.params.formId,
        query: {
          type: "PUBLIC",
          archivedAt: null,
        },
        selection: "name type description sections displayMode isClosed",
      })) as Parameters<typeof toSubmissionFormPresentation>[0] | null;
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
