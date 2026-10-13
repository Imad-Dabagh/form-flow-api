import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authenticate, validate } from "#app/middlewares/index";
import { ORGANIZATION_ROLES } from "#app/modules/_shared/constants";
import InvitationModule from "#app/modules/invitation/index";
import MembershipModule from "#app/modules/membership/index";
import OrganizationModule from "#app/modules/organization/index";
import { notFound, unauthorized } from "#app/utils/errors";
import { getTokenHash } from "#app/utils/invitation-token";

const router = Router({ mergeParams: true });

/**
 * POST /api/invitations/:token/accept
 */
router.post<{ token: string }>(
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
      const tokenHash = getTokenHash(req.params.token);
      const slug = await session.withTransaction(async () => {
        const invitation = (await InvitationModule.services.fetchOne({
          query: { tokenHash, status: "PENDING", expiresAt: { $gt: new Date() } },
          session,
        })) as {
          _id: unknown;
          organizationId: unknown;
          email: string;
          role: string;
        } | null;
        if (!invitation) throw notFound("Invitation");
        if (invitation.email !== req.auth!.email) throw unauthorized();

        const organization = (await OrganizationModule.services.fetchById({
          id: String(invitation.organizationId),
          query: { archivedAt: null, isDisabled: false },
          selection: "slug",
          session,
        })) as { slug: string } | null;
        if (!organization) throw notFound("Organization");

        const membership = (await MembershipModule.services.fetchOne({
          query: { organizationId: invitation.organizationId, userId: req.auth!.userId },
          session,
        })) as { _id: unknown; role: string } | null;
        if (!membership) {
          await MembershipModule.services.createOne({
            payload: {
              organizationId: invitation.organizationId,
              userId: req.auth!.userId,
              role: invitation.role,
            },
            session,
          });
        } else if (
          membership.role === ORGANIZATION_ROLES.USER ||
          (membership.role === ORGANIZATION_ROLES.MANAGER &&
            invitation.role === ORGANIZATION_ROLES.ADMIN)
        ) {
          await MembershipModule.services.updateById({
            id: String(membership._id),
            query: { organizationId: invitation.organizationId },
            payload: { $set: { role: invitation.role } },
            session,
          });
        }

        const accepted = await InvitationModule.services.updateById({
          id: String(invitation._id),
          query: { tokenHash, status: "PENDING" },
          payload: { $set: { status: "ACCEPTED", acceptedAt: new Date() } },
          session,
        });
        if (!accepted) throw notFound("Invitation");
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
