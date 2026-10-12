import { Router } from "express";
import { authorize } from "#app/middlewares/index";
import InvitationModule from "#app/modules/invitation/index";

const router = Router({ mergeParams: true });

/**
 * GET /api/orgs/:organizationSlug/invitations
 */
router.get("/", authorize("membership.read"), async (req, res, next) => {
  try {
    const invitations = (await InvitationModule.services.findMany({
      query: { organizationId: req.organizationAccess!.organizationId, status: "PENDING" },
      selection: "email role createdAt expiresAt",
      sort: { createdAt: -1 },
    })) as Array<{
      _id: unknown;
      email: string;
      role: string;
      createdAt: Date;
      expiresAt: Date;
    }>;
    const now = Date.now();

    return res.status(200).json({
      success: true,
      data: invitations.map((invitation) => ({
        id: String(invitation._id),
        email: invitation.email,
        role: invitation.role,
        status: invitation.expiresAt.getTime() > now ? "PENDING" : "EXPIRED",
        createdAt: invitation.createdAt,
        expiresAt: invitation.expiresAt,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
