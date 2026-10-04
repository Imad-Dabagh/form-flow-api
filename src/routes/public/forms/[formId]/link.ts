import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { validate } from "#app/middlewares/index";
import Form from "#app/modules/form/models/index";
import { resolveOrganizationBySlug } from "#app/middlewares/current-organization-by-slug";
import { notFound } from "#app/utils/errors";

const router = Router({ mergeParams: true });

/** GET /api/public/forms/:formId/link?organizationSlug=:organizationSlug */
router.get(
  "/",
  validate({
    params: z.object({
      formId: z.string().refine(mongoose.isValidObjectId, "A valid form ID is required."),
    }),
    query: z.object({
      organizationSlug: z.string().regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "A valid organization slug is required.",
      ),
    }),
  }),
  async (req, res, next) => {
    try {
      const organization = await resolveOrganizationBySlug(req.query.organizationSlug);
      const form = await Form.findOne({
        _id: req.params.formId,
        organizationId: organization.organizationId,
        archivedAt: null,
      }).select("type").lean();
      if (!form) throw notFound("Form");

      res.set("Cache-Control", "no-store");
      return res.status(200).json({
        success: true,
        data: { type: form.type },
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
