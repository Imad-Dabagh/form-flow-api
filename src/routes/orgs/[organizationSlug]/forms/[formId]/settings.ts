import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import { FORM_TYPES } from "#app/modules/_shared/constants";
import Form from "#app/modules/form/models/index";
import { notFound } from "#app/utils/errors";

const router = Router({ mergeParams: true });

/** PUT /api/orgs/:organizationSlug/forms/:formId/settings */
router.put(
  "/",
  authorize("form.update"),
  validate({
    params: z.object({
      formId: z.string().refine(mongoose.isValidObjectId, "A valid form ID is required."),
    }),
    body: z.strictObject({
      name: z.string().trim().min(1).max(100),
      type: z.enum(FORM_TYPES),
      displayMode: z.enum(["SINGLE_PAGE", "WIZARD"]),
      isClosed: z.boolean(),
    }),
  }),
  async (req, res, next) => {
    try {
      const form = await Form.findOneAndUpdate(
        {
          _id: req.params.formId,
          organizationId: req.organizationAccess!.organizationId,
          archivedAt: null,
        },
        { $set: {
          name: req.body.name.trim(),
          type: req.body.type,
          displayMode: req.body.displayMode,
          isClosed: req.body.isClosed,
        } },
        { new: true, runValidators: true },
      ).select("name type displayMode isClosed updatedAt");
      if (!form) throw notFound("Form");

      return res.status(200).json({
        success: true,
        data: {
          id: String(form._id),
          name: form.name,
          type: form.type ?? "AUTHENTICATED",
          displayMode: form.displayMode,
          isClosed: form.isClosed,
          updatedAt: form.updatedAt,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
