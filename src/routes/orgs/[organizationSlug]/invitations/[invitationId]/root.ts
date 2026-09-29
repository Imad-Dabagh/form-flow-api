import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authenticate, authorize, currentOrganizationBySlug, organizationAccess, validate } from "../../../../../middlewares/index.js";
import Invitation from "../../../../../modules/invitation/models/index.js";
import { notFound } from "../../../../../utils/errors.js";

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
  validate({
    params: z.object({
      invitationId: z.string().refine(mongoose.isValidObjectId, {
        message: "A valid invitation ID is required.",
      }),
    }),
  }),
  async (req, res, next) => {
    try {
      const invitationId = req.params.invitationId as string;

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
