import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authenticate, authorize, currentOrganizationBySlug, organizationAccess, validate } from "#app/middlewares/index";
import { ORGANIZATION_ROLES } from "#app/modules/_shared/constants";
import Membership from "#app/modules/membership/models/index";
import Organization from "#app/modules/organization/models/index";
import { conflict, notFound } from "#app/utils/errors";
import { teamRoles } from "#app/utils/organization-routes";

const router = Router({ mergeParams: true });

async function requireAnotherAdmin(
  organizationId: string,
  membershipId: string,
  session: mongoose.ClientSession,
) {
  const otherAdminExists = await Membership.exists({
    organizationId,
    _id: { $ne: membershipId },
    role: ORGANIZATION_ROLES.ADMIN,
  }).session(session);

  if (!otherAdminExists) {
    throw conflict("An organization must keep at least one admin.");
  }
}

async function lockOrganizationMemberships(organizationId: string, session: mongoose.ClientSession) {
  // Role changes in the same organization must serialize before checking the last admin.
  const result = await Organization.updateOne(
    { _id: organizationId, archivedAt: null },
    { $inc: { membershipRevision: 1 } },
    { session },
  );
  if (!result.matchedCount) throw notFound("Organization");
}

/**
 * PUT /api/orgs/:organizationSlug/members/:membershipId
 */
router.put(
  "/",
  authenticate,
  currentOrganizationBySlug,
  organizationAccess,
  authorize("membership.update"),
  validate({
    params: z.object({
      membershipId: z.string().refine(mongoose.isValidObjectId, {
        message: "A valid membership ID is required.",
      }),
    }),
    body: z.strictObject({
      role: z.string({ error: "role must be ADMIN or MANAGER." })
        .refine((role) => teamRoles.includes(role), {
          message: "role must be ADMIN or MANAGER.",
        }),
    }, { error: "role must be ADMIN or MANAGER." }),
  }),
  async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
      const membershipId = req.params.membershipId as string;
      const body = req.body;

      const result = await session.withTransaction(async () => {
        await lockOrganizationMemberships(req.organizationAccess!.organizationId, session);
        const membership = await Membership.findOne({
          _id: membershipId,
          organizationId: req.organizationAccess!.organizationId,
          role: { $in: teamRoles },
        }).session(session);
        if (!membership) throw notFound("Membership");

        if (membership.role === ORGANIZATION_ROLES.ADMIN && body.role !== ORGANIZATION_ROLES.ADMIN) {
          await requireAnotherAdmin(req.organizationAccess!.organizationId, membershipId, session);
        }

        membership.role = body.role as typeof membership.role;
        await membership.save({ session });
        return { id: String(membership._id), role: membership.role };
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
router.delete(
  "/",
  authenticate,
  currentOrganizationBySlug,
  organizationAccess,
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
      const membershipId = req.params.membershipId as string;

      await session.withTransaction(async () => {
        await lockOrganizationMemberships(req.organizationAccess!.organizationId, session);
        const membership = await Membership.findOne({
          _id: membershipId,
          organizationId: req.organizationAccess!.organizationId,
          role: { $in: teamRoles },
        }).session(session);
        if (!membership) throw notFound("Membership");

        if (membership.role === ORGANIZATION_ROLES.ADMIN) {
          await requireAnotherAdmin(req.organizationAccess!.organizationId, membershipId, session);
        }

        await membership.deleteOne({ session });
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
