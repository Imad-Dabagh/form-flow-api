import { Router } from "express";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import { ORGANIZATION_PRIMARY_COLORS } from "#app/modules/_shared/constants";
import Organization from "#app/modules/organization/models/index";
import { notFound } from "#app/utils/errors";
import { httpsUrlSchema } from "#app/utils/https-url-schema";
import { primaryColorSchema, toOrganizationResponse } from "#app/utils/organization-routes";

const router = Router({ mergeParams: true });

/**
 * PUT /api/orgs/:organizationSlug
 */
router.put(
  "/",
  authorize("organization.update"),
  validate({
    body: z.strictObject({
      name: z.string({ error: "name is required." }).trim()
        .min(1, "name is required.")
        .max(50, "name must be 50 characters or fewer.").optional(),
      logo: httpsUrlSchema("logo").optional(),
      primaryColor: primaryColorSchema.nullish(),
      slogan: z.string({ error: "slogan must be a string." }).trim()
        .max(120, "slogan must be 120 characters or fewer.").optional(),
      shortDescription: z.string({ error: "shortDescription must be a string." }).trim()
        .max(500, "shortDescription must be 500 characters or fewer.").optional(),
    }, { error: "Only name, logo, primaryColor, slogan, and shortDescription can be updated." })
      .refine((body) => Object.keys(body).length > 0, {
        message: "Only name, logo, primaryColor, slogan, and shortDescription can be updated.",
      }),
  }),
  async (req, res, next) => {
    try {
      const body = req.body;
      const updates: Record<string, string> = {};

      if ("name" in body) {
        updates.name = body.name.trim();
      }
      if ("logo" in body) {
        updates.logo = body.logo.trim();
      }
      if ("primaryColor" in body) updates.primaryColor = body.primaryColor ?? ORGANIZATION_PRIMARY_COLORS.BLUE;
      if ("slogan" in body) updates.slogan = body.slogan.trim();
      if ("shortDescription" in body) {
        updates.shortDescription = body.shortDescription.trim();
      }

      const organization = await Organization.findOneAndUpdate(
        { _id: req.organizationAccess!.organizationId, archivedAt: null },
        { $set: updates },
        { returnDocument: "after", runValidators: true },
      );

      if (!organization) throw notFound("Organization");

      return res.status(200).json({
        success: true,
        data: toOrganizationResponse(organization),
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
