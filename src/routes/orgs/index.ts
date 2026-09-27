import { Router } from "express";
import mongoose from "mongoose";
import {
  authenticate,
  authorize,
  currentOrganizationBySlug,
  organizationAccess,
} from "../../middlewares/index.js";
import {
  ORGANIZATION_PRIMARY_COLORS,
  ORGANIZATION_ROLES,
  type OrganizationPrimaryColor,
} from "../../modules/_shared/constants.js";
import Membership from "../../modules/membership/models/index.js";
import Organization from "../../modules/organization/models/index.js";
import User from "../../modules/user/models/index.js";
import {
  badRequest,
  conflict,
  internalError,
  notFound,
} from "../../utils/errors.js";
import { optionalHttpsUrl } from "../../utils/request-values.js";

const router = Router();
const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ORGANIZATION_ROLE_PRIORITY: Record<string, number> = {
  [ORGANIZATION_ROLES.ADMIN]: 0,
  [ORGANIZATION_ROLES.MANAGER]: 1,
  [ORGANIZATION_ROLES.USER]: 2,
};
const organizationPrimaryColors = Object.values(ORGANIZATION_PRIMARY_COLORS);
const editableOrganizationFields = new Set([
  "name",
  "logo",
  "primaryColor",
  "slogan",
  "shortDescription",
]);

function getBody(req: { body: unknown }): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw badRequest("A JSON object is required.");
  }

  return req.body as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];

  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${field} is required.`);
  }

  return value.trim();
}

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

function getPrimaryColor(
  body: Record<string, unknown>,
): OrganizationPrimaryColor {
  const value = body.primaryColor ?? ORGANIZATION_PRIMARY_COLORS.BLUE;

  if (
    typeof value !== "string" ||
    !organizationPrimaryColors.includes(value as OrganizationPrimaryColor)
  ) {
    throw badRequest(
      `primaryColor must be one of: ${organizationPrimaryColors.join(", ")}.`,
    );
  }

  return value as OrganizationPrimaryColor;
}

function normalizePrimaryColor(value?: string): OrganizationPrimaryColor {
  return organizationPrimaryColors.includes(value as OrganizationPrimaryColor)
    ? (value as OrganizationPrimaryColor)
    : ORGANIZATION_PRIMARY_COLORS.BLUE;
}

function toOrganizationResponse(organization: {
  _id: unknown;
  name: string;
  slug: string;
  logo?: string;
  primaryColor?: string;
  slogan?: string;
  shortDescription?: string;
}): Record<string, string> {
  return {
    id: String(organization._id),
    name: organization.name,
    slug: organization.slug,
    logo: organization.logo ?? "",
    primaryColor: normalizePrimaryColor(organization.primaryColor),
    slogan: organization.slogan ?? "",
    shortDescription: organization.shortDescription ?? "",
  };
}

function activeOrganizationQuery() {
  return { archivedAt: null, isDisabled: false };
}

/**
 * GET /api/orgs
 */
router.get("/", authenticate, async (req, res, next) => {
  try {
    if (req.auth!.isSuperAdmin) {
      const [organizations, memberships] = await Promise.all([
        Organization.find({ archivedAt: null })
          .select("name slug logo primaryColor slogan shortDescription")
          .sort({ createdAt: 1 }),
        Membership.find({ userId: req.auth!.userId })
          .select("role organizationId")
          .lean(),
      ]);
      const roleByOrganizationId = new Map<string, string>(
        memberships.map((membership): [string, string] => [
          String(membership.organizationId),
          membership.role,
        ]),
      );

      return res.status(200).json({
        success: true,
        data: organizations.map((organization) => ({
          ...toOrganizationResponse(organization),
          role: roleByOrganizationId.get(String(organization._id)) ?? null,
        })),
      });
    }

    const memberships = await Membership.find({ userId: req.auth!.userId })
      .select("role organizationId")
      .populate({
        path: "organizationId",
        match: activeOrganizationQuery(),
        select: "name slug logo primaryColor slogan shortDescription",
      })
      .sort({ createdAt: 1 });

    memberships.sort(
      (left, right) =>
        ORGANIZATION_ROLE_PRIORITY[left.role] -
        ORGANIZATION_ROLE_PRIORITY[right.role],
    );

    const organizations = memberships.flatMap((membership) => {
      const organization = membership.organizationId;

      if (
        !organization ||
        typeof organization !== "object" ||
        !("_id" in organization)
      ) {
        return [];
      }

      return [
        {
          ...toOrganizationResponse(
            organization as {
              _id: unknown;
              name: string;
              slug: string;
              logo?: string;
              primaryColor?: string;
              slogan?: string;
              shortDescription?: string;
            },
          ),
          role: membership.role,
        },
      ];
    });

    return res.status(200).json({ success: true, data: organizations });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/orgs
 */
router.post("/", authenticate, async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const body = getBody(req);
    const name = requiredString(body, "name");
    const slug = requiredString(body, "slug").toLowerCase();
    const primaryColor = getPrimaryColor(body);
    const logo = optionalHttpsUrl(body, "logo");

    if (name.length > 50) {
      throw badRequest("name must be 50 characters or fewer.");
    }

    if (!ORGANIZATION_SLUG_PATTERN.test(slug)) {
      throw badRequest(
        "slug must use lowercase letters, numbers, and single hyphens only.",
      );
    }

    if (slug.length > 20) {
      throw badRequest("slug must be 20 characters or fewer.");
    }

    const organization = await session.withTransaction(async () => {
      const slugAlreadyInUse = await Organization.exists({ slug }).session(
        session,
      );

      if (slugAlreadyInUse) {
        throw conflict("This organization slug is already in use.");
      }

      const [createdOrganization] = await Organization.create(
        [{ name, slug, primaryColor, ...(logo !== undefined ? { logo } : {}) }],
        { session },
      );
      await Membership.create(
        [
          {
            userId: req.auth!.userId,
            organizationId: createdOrganization._id,
            role: ORGANIZATION_ROLES.ADMIN,
          },
        ],
        { session },
      );
      await User.updateOne(
        { _id: req.auth!.userId, onboardingCompletedAt: null },
        { $set: { onboardingCompletedAt: new Date() } },
        { session },
      );

      return createdOrganization;
    });

    if (!organization) {
      throw internalError();
    }

    return res.status(201).json({
      success: true,
      data: {
        ...toOrganizationResponse(organization),
        role: ORGANIZATION_ROLES.ADMIN,
      },
    });
  } catch (error) {
    return next(error);
  } finally {
    await session.endSession();
  }
});

/**
 * PUT /api/orgs/:organizationSlug
 */
router.put(
  "/:organizationSlug",
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
