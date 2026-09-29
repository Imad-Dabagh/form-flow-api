import { Router } from "express";
import mongoose from "mongoose";
import { authenticate } from "../../middlewares/index.js";
import { ORGANIZATION_ROLES } from "../../modules/_shared/constants.js";
import Membership from "../../modules/membership/models/index.js";
import Organization from "../../modules/organization/models/index.js";
import User from "../../modules/user/models/index.js";
import { badRequest, conflict, internalError } from "../../utils/errors.js";
import { getPrimaryColor, toOrganizationResponse } from "../../utils/organization-routes.js";
import { getBody, optionalHttpsUrl, requiredString } from "../../utils/request-values.js";

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

export default router;
