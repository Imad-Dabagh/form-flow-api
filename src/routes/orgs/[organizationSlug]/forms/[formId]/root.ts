import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import Form from "#app/modules/form/models/index";
import { notFound } from "#app/utils/errors";

const router = Router({ mergeParams: true });

/**
 * GET /api/orgs/:organizationSlug/forms/:formId
 */
router.get(
  "/",
  authorize("form.read"),
  validate({
    params: z.object({
      formId: z.string().refine(mongoose.isValidObjectId, {
        message: "A valid form ID is required.",
      }),
    }),
  }),
  async (req, res, next) => {
    try {
      const form = await Form.findOne({
        _id: req.params.formId,
        organizationId: req.organizationAccess!.organizationId,
        archivedAt: null,
      })
        .select("name description sections displayMode isClosed createdAt updatedAt")
        .lean();
      if (!form) throw notFound("Form");

      return res.status(200).json({
        success: true,
        data: {
          id: String(form._id),
          name: form.name,
          description: form.description,
          sections: form.sections,
          displayMode: form.displayMode,
          isClosed: form.isClosed,
          createdAt: form.createdAt,
          updatedAt: form.updatedAt,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
