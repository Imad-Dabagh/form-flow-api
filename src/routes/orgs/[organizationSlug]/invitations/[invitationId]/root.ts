import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import InvitationModule from "#app/modules/invitation/index";
import { notFound } from "#app/utils/errors";

const router = Router({ mergeParams: true });

/**
 * DELETE /api/orgs/:organizationSlug/invitations/:invitationId
 */
router.delete<{ invitationId: string }>(
  "/",
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
      const invitationId = req.params.invitationId;

      const invitation = await InvitationModule.services.updateById({
        id: invitationId,
        query: {
          organizationId: req.organizationAccess!.organizationId,
          status: "PENDING",
          expiresAt: { $gt: new Date() },
        },
        payload: { $set: { status: "CANCELLED" } },
      });
      if (!invitation) throw notFound("Invitation");

      return res.status(200).json({ success: true, data: { id: invitationId } });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
