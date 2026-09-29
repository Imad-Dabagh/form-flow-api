import { createHash } from "node:crypto";
import { Router } from "express";
import mongoose from "mongoose";
import { authenticate } from "../../middlewares/index.js";
import Invitation from "../../modules/invitation/models/index.js";
import Membership from "../../modules/membership/models/index.js";
import Organization from "../../modules/organization/models/index.js";
import { ORGANIZATION_ROLES } from "../../modules/_shared/constants.js";
import { badRequest, notFound, unauthorized } from "../../utils/errors.js";

const router = Router();

function getTokenHash(token: unknown): string {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    throw badRequest("A valid invitation link is required.");
  }
  return createHash("sha256").update(token).digest("hex");
}

/**
 * GET /api/invitations/:token
 */
router.get("/:token", authenticate, async (req, res, next) => {
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

/**
 * POST /api/invitations/:token/accept
 */
router.post("/:token/accept", authenticate, async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const tokenHash = getTokenHash(req.params.token);
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
      }).select("slug").session(session);
      if (!organization) throw notFound("Organization");

      const membership = await Membership.findOne({
        organizationId: invitation.organizationId,
        userId: req.auth!.userId,
      }).session(session);
      if (!membership) {
        await Membership.create([{
          organizationId: invitation.organizationId,
          userId: req.auth!.userId,
          role: invitation.role,
        }], { session });
      } else if (
        membership.role === ORGANIZATION_ROLES.USER ||
        (membership.role === ORGANIZATION_ROLES.MANAGER && invitation.role === ORGANIZATION_ROLES.ADMIN)
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
});

export default router;
