import { Router } from "express";
import { authenticate, authorize, currentOrganizationBySlug, organizationAccess } from "../../../middlewares/index.js";
import Organization from "../../../modules/organization/models/index.js";
import { badRequest, notFound } from "../../../utils/errors.js";
import { getPrimaryColor, toOrganizationResponse } from "../../../utils/organization-routes.js";
import { getBody, optionalHttpsUrl, requiredString } from "../../../utils/request-values.js";

const router = Router({ mergeParams: true });

const editableOrganizationFields = new Set([
  "name",
  "logo",
  "primaryColor",
  "slogan",
  "shortDescription",
]);

function editableText(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
): string {
  const value = body[field];

  if (typeof value !== "string") {
    throw badRequest(`${field} must be a string.`);
  }

  const text = value.trim();
  if (text.length > maxLength) {
    throw badRequest(`${field} must be ${maxLength} characters or fewer.`);
  }

  return text;
}

/**
 * PUT /api/orgs/:organizationSlug
 */
router.put(
  "/",
  authenticate,
  currentOrganizationBySlug,
  organizationAccess,
  authorize("organization.update"),
  async (req, res, next) => {
    try {
      const body = getBody(req);
      const fields = Object.keys(body);

      if (
        !fields.length ||
        fields.some((field) => !editableOrganizationFields.has(field))
      ) {
        throw badRequest(
          "Only name, logo, primaryColor, slogan, and shortDescription can be updated.",
        );
      }

      const updates: Record<string, string> = {};

      if ("name" in body) {
        const name = requiredString(body, "name");
        if (name.length > 50) {
          throw badRequest("name must be 50 characters or fewer.");
        }
        updates.name = name;
      }
      if ("logo" in body) {
        const logo = optionalHttpsUrl(body, "logo");
        if (logo === undefined) throw badRequest("logo must be a URL.");
        updates.logo = logo;
      }
      if ("primaryColor" in body) updates.primaryColor = getPrimaryColor(body);
      if ("slogan" in body) updates.slogan = editableText(body, "slogan", 120);
      if ("shortDescription" in body) {
        updates.shortDescription = editableText(body, "shortDescription", 500);
      }

      const organization = await Organization.findOneAndUpdate(
        { _id: req.organizationAccess!.organizationId, archivedAt: null },
        { $set: updates },
        { new: true, runValidators: true },
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
