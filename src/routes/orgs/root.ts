import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { validate } from "#app/middlewares/index";
import { COLOR_FAMILIES, ORGANIZATION_ROLES } from "#app/modules/_shared/constants";
import MembershipModule from "#app/modules/membership/index";
import OrganizationModule from "#app/modules/organization/index";
import UserModule from "#app/modules/user/index";
import { conflict, internalError } from "#app/utils/errors";
import { httpsUrlSchema } from "#app/utils/https-url-schema";
import { primaryColorSchema, toOrganizationResponse } from "#app/utils/organization-routes";

const router = Router({ mergeParams: true });

const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ORGANIZATION_ROLE_PRIORITY: Record<string, number> = {
  [ORGANIZATION_ROLES.ADMIN]: 0,
  [ORGANIZATION_ROLES.MANAGER]: 1,
  [ORGANIZATION_ROLES.USER]: 2,
};

type OrganizationSummary = Parameters<typeof toOrganizationResponse>[0];

interface MembershipSummary {
  role: string;
  organizationId: unknown;
}

interface PopulatedMembership {
  role: string;
  organizationId: OrganizationSummary | null;
}

function activeOrganizationQuery() {
  return { archivedAt: null, isDisabled: false };
}

/**
 * GET /api/orgs
 */
router.get("/", async (req, res, next) => {
  try {
    if (req.auth!.isSuperAdmin) {
      const [organizations, memberships] = await Promise.all([
        OrganizationModule.services.findMany({
          query: { archivedAt: null },
          selection: "name slug logo primaryColor slogan shortDescription",
          sort: { createdAt: 1 },
        }) as Promise<OrganizationSummary[]>,
        MembershipModule.services.findMany({
          query: { userId: req.auth!.userId },
          selection: "role organizationId",
        }) as Promise<MembershipSummary[]>,
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

    const memberships = (await MembershipModule.services.findMany({
      query: { userId: req.auth!.userId },
      selection: "role organizationId",
      populate: {
        path: "organizationId",
        match: activeOrganizationQuery(),
        select: "name slug logo primaryColor slogan shortDescription",
      },
      sort: { createdAt: 1 },
    })) as PopulatedMembership[];

    memberships.sort(
      (left, right) =>
        ORGANIZATION_ROLE_PRIORITY[left.role] - ORGANIZATION_ROLE_PRIORITY[right.role],
    );

    const organizations = memberships.flatMap((membership) => {
      const organization = membership.organizationId;

      if (!organization || typeof organization !== "object" || !("_id" in organization)) {
        return [];
      }

      return [
        {
          ...toOrganizationResponse(organization),
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
router.post(
  "/",
  validate({
    body: z.object({
      name: z
        .string({ error: "name is required." })
        .trim()
        .min(1, "name is required.")
        .max(50, "name must be 50 characters or fewer."),
      slug: z
        .string({ error: "slug is required." })
        .trim()
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
  }),
  async (req, res, next) => {
    const session = await mongoose.startSession();

    try {
      const name = req.body.name.trim();
      const slug = req.body.slug.trim().toLowerCase();
      const primaryColor = req.body.primaryColor ?? COLOR_FAMILIES.BLUE;
      const logo = req.body.logo?.trim();

      const organization = await session.withTransaction(async () => {
        const slugAlreadyInUse = await OrganizationModule.services.exists({
          query: { slug },
          session,
        });

        if (slugAlreadyInUse) {
          throw conflict("This organization slug is already in use.");
        }

        const createdOrganization = (await OrganizationModule.services.createOne({
          payload: { name, slug, primaryColor, ...(logo !== undefined ? { logo } : {}) },
          session,
        })) as OrganizationSummary;
        await MembershipModule.services.createOne({
          payload: {
            userId: req.auth!.userId,
            organizationId: createdOrganization._id,
            role: ORGANIZATION_ROLES.ADMIN,
          },
          session,
        });
        await UserModule.services.updateOne({
          query: { _id: req.auth!.userId, onboardingCompletedAt: null },
          payload: { $set: { onboardingCompletedAt: new Date() } },
          session,
        });

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
  },
);

export default router;
