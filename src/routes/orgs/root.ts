import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authenticate, validate } from "../../middlewares/index.js";
import { ORGANIZATION_PRIMARY_COLORS, ORGANIZATION_ROLES } from "../../modules/_shared/constants.js";
import Membership from "../../modules/membership/models/index.js";
import Organization from "../../modules/organization/models/index.js";
import User from "../../modules/user/models/index.js";
import { conflict, internalError } from "../../utils/errors.js";
import { httpsUrlSchema } from "../../utils/https-url-schema.js";
import { primaryColorSchema, toOrganizationResponse } from "../../utils/organization-routes.js";

const router = Router({ mergeParams: true });

const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ORGANIZATION_ROLE_PRIORITY: Record<string, number> = {
  [ORGANIZATION_ROLES.ADMIN]: 0,
  [ORGANIZATION_ROLES.MANAGER]: 1,
  [ORGANIZATION_ROLES.USER]: 2,
};

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
router.post("/", authenticate, validate({
  body: z.object({
    name: z.string({ error: "name is required." }).trim()
      .min(1, "name is required.")
      .max(50, "name must be 50 characters or fewer."),
    slug: z.string({ error: "slug is required." }).trim()
      .min(1, "slug is required.")
      .refine((value) => ORGANIZATION_SLUG_PATTERN.test(value.toLowerCase()), {
        message: "slug must use lowercase letters, numbers, and single hyphens only.",
      })
      .refine((value) => value.length <= 20, {
        message: "slug must be 20 characters or fewer.",
      }),
    primaryColor: primaryColorSchema.nullish(),
    logo: httpsUrlSchema("logo").optional(),
  }),
}), async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const name = req.body.name.trim();
    const slug = req.body.slug.trim().toLowerCase();
    const primaryColor = req.body.primaryColor ?? ORGANIZATION_PRIMARY_COLORS.BLUE;
    const logo = req.body.logo?.trim();

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

export default router;
