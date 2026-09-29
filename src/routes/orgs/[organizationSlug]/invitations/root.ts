import { Router } from "express";
import { authenticate, authorize, currentOrganizationBySlug, organizationAccess } from "#app/middlewares/index";
import Invitation from "#app/modules/invitation/models/index";

const router = Router({ mergeParams: true });

/**
 * GET /api/orgs/:organizationSlug/invitations
 */
router.get(
  "/",
  authenticate,
  currentOrganizationBySlug,
  organizationAccess,
  authorize("membership.read"),
  async (req, res, next) => {
    try {
      const invitations = await Invitation.find({
        organizationId: req.organizationAccess!.organizationId,
        status: "PENDING",
      })
        .select("email role createdAt expiresAt")
        .sort({ createdAt: -1 })
        .lean();
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
  },
);

export default router;
