import { Router } from "express";
import { z } from "zod";
import { authenticate, validate } from "#app/middlewares/index";
import Invitation from "#app/modules/invitation/models/index";
import Organization from "#app/modules/organization/models/index";
import { notFound, unauthorized } from "#app/utils/errors";
import { getTokenHash } from "#app/utils/invitation-token";

const router = Router({ mergeParams: true });

/**
 * GET /api/invitations/:token
 */
router.get("/", authenticate, validate({
  params: z.object({
    token: z.string({ error: "A valid invitation link is required." })
      .regex(/^[a-f0-9]{64}$/, "A valid invitation link is required."),
  }),
}), async (req, res, next) => {
  try {
    const tokenHash = getTokenHash(req.params.token as string);
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
