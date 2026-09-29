import { Router } from "express";
import mongoose from "mongoose";
import { authenticate, authorize, currentOrganizationBySlug, organizationAccess } from "../../../../../middlewares/index.js";
import { ORGANIZATION_ROLES } from "../../../../../modules/_shared/constants.js";
import Membership from "../../../../../modules/membership/models/index.js";
import Organization from "../../../../../modules/organization/models/index.js";
import { badRequest, conflict, notFound } from "../../../../../utils/errors.js";
import { teamRoles } from "../../../../../utils/organization-routes.js";
import { getBody } from "../../../../../utils/request-values.js";

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
  async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
      const { membershipId } = req.params;
      if (typeof membershipId !== "string" || !mongoose.isValidObjectId(membershipId)) {
        throw badRequest("A valid membership ID is required.");
      }

      const body = getBody(req);
      if (Object.keys(body).length !== 1 || !teamRoles.includes(body.role as string)) {
        throw badRequest("role must be ADMIN or MANAGER.");
      }

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
  async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
      const { membershipId } = req.params;
      if (typeof membershipId !== "string" || !mongoose.isValidObjectId(membershipId)) {
        throw badRequest("A valid membership ID is required.");
      }

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
