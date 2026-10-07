import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authenticate, validate } from "#app/middlewares/index";
import { ORGANIZATION_ROLES } from "#app/modules/_shared/constants";
import Invitation from "#app/modules/invitation/models/index";
import Membership from "#app/modules/membership/models/index";
import Organization from "#app/modules/organization/models/index";
import { notFound, unauthorized } from "#app/utils/errors";
import { getTokenHash } from "#app/utils/invitation-token";

const router = Router({ mergeParams: true });

/**
 * POST /api/invitations/:token/accept
 */
router.post(
  "/",
  authenticate,
  validate({
    params: z.object({
      token: z
        .string({ error: "A valid invitation link is required." })
        .regex(/^[a-f0-9]{64}$/, "A valid invitation link is required."),
    }),
  }),
  async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
      const tokenHash = getTokenHash(req.params.token as string);
      const slug = await session.withTransaction(async () => {
        const invitation = await Invitation.findOne({
          tokenHash,
          status: "PENDING",
          expiresAt: { $gt: new Date() },
        }).session(session);
        if (!invitation) throw notFound("Invitation");
        if (invitation.email !== req.auth!.email) throw unauthorized();

        const organization = await Organization.findOne({
          _id: invitation.organizationId,
          archivedAt: null,
          isDisabled: false,
        })
          .select("slug")
          .session(session);
        if (!organization) throw notFound("Organization");

        const membership = await Membership.findOne({
          organizationId: invitation.organizationId,
          userId: req.auth!.userId,
        }).session(session);
        if (!membership) {
          await Membership.create(
            [
              {
                organizationId: invitation.organizationId,
                userId: req.auth!.userId,
                role: invitation.role,
              },
            ],
            { session },
          );
        } else if (
          membership.role === ORGANIZATION_ROLES.USER ||
          (membership.role === ORGANIZATION_ROLES.MANAGER &&
            invitation.role === ORGANIZATION_ROLES.ADMIN)
        ) {
          membership.role = invitation.role;
          await membership.save({ session });
        }

        invitation.status = "ACCEPTED";
        invitation.acceptedAt = new Date();
        await invitation.save({ session });
        return organization.slug;
      });

      return res.status(200).json({ success: true, data: { organizationSlug: slug } });
    } catch (error) {
      return next(error);
    } finally {
      await session.endSession();
    }
  },
);

export default router;
