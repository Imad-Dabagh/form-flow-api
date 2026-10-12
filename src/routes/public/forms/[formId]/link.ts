import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { validate } from "#app/middlewares/index";
import FormModule from "#app/modules/form/index";
import { resolveOrganizationBySlug } from "#app/middlewares/current-organization-by-slug";
import { notFound } from "#app/utils/errors";

const router = Router({ mergeParams: true });

/** GET /api/public/forms/:formId/link?organizationSlug=:organizationSlug */
router.get<{ formId: string }>(
  "/",
  validate({
    params: z.object({
      formId: z.string().refine(mongoose.isValidObjectId, "A valid form ID is required."),
    }),
    query: z.object({
      organizationSlug: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "A valid organization slug is required."),
    }),
  }),
  async (req, res, next) => {
    try {
      const organization = await resolveOrganizationBySlug(req.query.organizationSlug);
      const form = (await FormModule.services.fetchById({
        id: req.params.formId,
        query: {
          organizationId: organization.organizationId,
          archivedAt: null,
        },
        selection: "type",
      })) as { type: string } | null;
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
