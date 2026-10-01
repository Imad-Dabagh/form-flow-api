import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import Form from "#app/modules/form/models/index";
import { notFound } from "#app/utils/errors";
import { updateFormSchema } from "./update-schema.js";

const router = Router({ mergeParams: true });
const formIdSchema = z.string().refine(mongoose.isValidObjectId, {
  message: "A valid form ID is required.",
});

function formResponse(form: any) {
  return {
    id: String(form._id),
    name: form.name,
    type: form.type ?? "AUTHENTICATED",
    description: form.description,
    sections: form.sections,
    displayMode: form.displayMode ?? "SINGLE_PAGE",
    isClosed: form.isClosed ?? false,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
  };
}

/**
 * GET /api/orgs/:organizationSlug/forms/:formId
 */
router.get(
  "/",
  authorize("form.read"),
  validate({
    params: z.object({
      formId: formIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const form = await Form.findOne({
        _id: req.params.formId,
        organizationId: req.organizationAccess!.organizationId,
        archivedAt: null,
      })
        .select("name type description sections displayMode isClosed createdAt updatedAt")
        .lean();
      if (!form) throw notFound("Form");

      return res.status(200).json({
        success: true,
        data: formResponse(form),
      });
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * PUT /api/orgs/:organizationSlug/forms/:formId
 */
router.put(
  "/",
  authorize("form.update"),
  validate({
    params: z.object({ formId: formIdSchema }),
    body: updateFormSchema,
  }),
  async (req, res, next) => {
    try {
      const form = await Form.findOneAndUpdate(
        {
          _id: req.params.formId,
          organizationId: req.organizationAccess!.organizationId,
          archivedAt: null,
        },
        { $set: req.body },
        { new: true, runValidators: true },
      ).select("name type description sections displayMode isClosed createdAt updatedAt");
      if (!form) throw notFound("Form");

      return res.status(200).json({ success: true, data: formResponse(form) });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
