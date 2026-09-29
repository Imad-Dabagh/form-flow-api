import { Router } from "express";
import { authenticate } from "../../../middlewares/index.js";
import Invitation from "../../../modules/invitation/models/index.js";
import Organization from "../../../modules/organization/models/index.js";
import { notFound, unauthorized } from "../../../utils/errors.js";
import { getTokenHash } from "../../../utils/invitation-token.js";

const router = Router({ mergeParams: true });

/**
 * GET /api/invitations/:token
 */
router.get("/", authenticate, async (req, res, next) => {
  try {
    const tokenHash = getTokenHash(req.params.token);
    const invitation = await Invitation.findOne({
      tokenHash,
      status: "PENDING",
      expiresAt: { $gt: new Date() },
    });
    if (!invitation) throw notFound("Invitation");
    if (invitation.email !== req.auth!.email) throw unauthorized();

    const organization = await Organization.findOne({
      _id: invitation.organizationId,
      archivedAt: null,
      isDisabled: false,
    }).select("name slug").lean();
    if (!organization) throw notFound("Organization");

    return res.status(200).json({
      success: true,
      data: {
        organizationName: organization.name,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
