import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import { ORGANIZATION_ROLES } from "#app/modules/_shared/constants";
import MembershipModule from "#app/modules/membership/index";
import OrganizationModule from "#app/modules/organization/index";
import { conflict, notFound } from "#app/utils/errors";
import { teamRoles } from "#app/utils/organization-routes";

const router = Router({ mergeParams: true });

async function requireAnotherAdmin(
  organizationId: string,
  membershipId: string,
  session: mongoose.ClientSession,
) {
  const otherAdminExists = await MembershipModule.services.exists({
    query: {
      organizationId,
      _id: { $ne: membershipId },
      role: ORGANIZATION_ROLES.ADMIN,
    },
    session,
  });

  if (!otherAdminExists) {
    throw conflict("An organization must keep at least one admin.");
  }
}

async function lockOrganizationMemberships(
  organizationId: string,
  session: mongoose.ClientSession,
) {
  // Role changes in the same organization must serialize before checking the last admin.
  const organization = await OrganizationModule.services.updateById({
    id: organizationId,
    query: { archivedAt: null },
    payload: { $inc: { membershipRevision: 1 } },
    session,
  });
  if (!organization) throw notFound("Organization");
}

/**
 * PUT /api/orgs/:organizationSlug/members/:membershipId
 */
router.put<{ membershipId: string }>(
  "/",
  authorize("membership.update"),
  validate({
    params: z.object({
      membershipId: z.string().refine(mongoose.isValidObjectId, {
        message: "A valid membership ID is required.",
      }),
    }),
    body: z.strictObject(
      {
        role: z
          .string({ error: "role must be ADMIN or MANAGER." })
          .refine((role) => teamRoles.includes(role), {
            message: "role must be ADMIN or MANAGER.",
          }),
      },
      { error: "role must be ADMIN or MANAGER." },
    ),
  }),
  async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
      const membershipId = req.params.membershipId;
      const body = req.body;

      const result = await session.withTransaction(async () => {
        await lockOrganizationMemberships(req.organizationAccess!.organizationId, session);
        const membership = (await MembershipModule.services.fetchById({
          id: membershipId,
          query: { organizationId: req.organizationAccess!.organizationId, role: { $in: teamRoles } },
          session,
        })) as { _id: unknown; role: string } | null;
        if (!membership) throw notFound("Membership");

        if (
          membership.role === ORGANIZATION_ROLES.ADMIN &&
          body.role !== ORGANIZATION_ROLES.ADMIN
        ) {
          await requireAnotherAdmin(req.organizationAccess!.organizationId, membershipId, session);
        }

        const updated = (await MembershipModule.services.updateById({
          id: membershipId,
          query: { organizationId: req.organizationAccess!.organizationId, role: { $in: teamRoles } },
          payload: { $set: { role: body.role } },
          session,
        })) as { _id: unknown; role: string } | null;
        if (!updated) throw notFound("Membership");
        return { id: String(updated._id), role: updated.role };
      });
      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      return next(error);
    } finally {
      await session.endSession();
    }
  },
);

/**
 * DELETE /api/orgs/:organizationSlug/members/:membershipId
 */
router.delete<{ membershipId: string }>(
  "/",
  authorize("membership.delete"),
  validate({
    params: z.object({
      membershipId: z.string().refine(mongoose.isValidObjectId, {
        message: "A valid membership ID is required.",
      }),
    }),
  }),
  async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
      const membershipId = req.params.membershipId;

      await session.withTransaction(async () => {
        await lockOrganizationMemberships(req.organizationAccess!.organizationId, session);
        const membership = (await MembershipModule.services.fetchById({
          id: membershipId,
          query: { organizationId: req.organizationAccess!.organizationId, role: { $in: teamRoles } },
          session,
        })) as { _id: unknown; role: string } | null;
        if (!membership) throw notFound("Membership");

        if (membership.role === ORGANIZATION_ROLES.ADMIN) {
          await requireAnotherAdmin(req.organizationAccess!.organizationId, membershipId, session);
        }

        await MembershipModule.services.deleteById({
          id: membershipId,
          query: { organizationId: req.organizationAccess!.organizationId, role: { $in: teamRoles } },
          session,
        });
      });
      return res.status(200).json({ success: true, data: { id: membershipId } });
    } catch (error) {
      return next(error);
    } finally {
      await session.endSession();
    }
  },
);

export default router;
