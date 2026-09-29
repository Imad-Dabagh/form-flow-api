import { Router } from "express";
import mongoose from "mongoose";
import { authenticate, authorize, currentOrganizationBySlug, organizationAccess } from "../../../../../middlewares/index.js";
import Invitation from "../../../../../modules/invitation/models/index.js";
import { badRequest, notFound } from "../../../../../utils/errors.js";

const router = Router({ mergeParams: true });

/**
 * DELETE /api/orgs/:organizationSlug/invitations/:invitationId
 */
router.delete(
  "/",
  authenticate,
  currentOrganizationBySlug,
  organizationAccess,
  authorize("membership.delete"),
  async (req, res, next) => {
    try {
      const { invitationId } = req.params;
      if (typeof invitationId !== "string" || !mongoose.isValidObjectId(invitationId)) {
        throw badRequest("A valid invitation ID is required.");
      }

      const invitation = await Invitation.findOneAndUpdate(
        {
          _id: invitationId,
          organizationId: req.organizationAccess!.organizationId,
          status: "PENDING",
          expiresAt: { $gt: new Date() },
        },
        { $set: { status: "CANCELLED" } },
      );
      if (!invitation) throw notFound("Invitation");

      return res.status(200).json({ success: true, data: { id: invitationId } });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
