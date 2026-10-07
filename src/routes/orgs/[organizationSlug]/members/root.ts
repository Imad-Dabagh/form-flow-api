import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import config from "#app/config/index";
import { authorize, validate } from "#app/middlewares/index";
import { ORGANIZATION_ROLES } from "#app/modules/_shared/constants";
import Invitation from "#app/modules/invitation/models/index";
import Membership from "#app/modules/membership/models/index";
import Organization from "#app/modules/organization/models/index";
import User from "#app/modules/user/models/index";
import { ensureUserProfile } from "#app/modules/user/services/index";
import { sendOrganizationInvitationEmail } from "#app/services/email/send-email";
import { conflict, internalError, notFound, tooManyRequests } from "#app/utils/errors";
import { findAuthAccount, teamEmailSchema, teamRoles } from "#app/utils/organization-routes";

const router = Router({ mergeParams: true });

const memberAddRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  identifier: "organization-member-add",
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.auth!.userId,
  handler: (_req, _res, next) =>
    next(tooManyRequests("Member add limit reached. Try again later.")),
});

/**
 * GET /api/orgs/:organizationSlug/members
 */
router.get("/", authorize("membership.read"), async (req, res, next) => {
  try {
    const memberships = await Membership.find({
      organizationId: req.organizationAccess!.organizationId,
      role: { $in: teamRoles },
    })
      .select("userId role createdAt")
      .sort({ role: 1, createdAt: 1 })
      .lean();

    const users = await User.find({
      _id: { $in: memberships.map((membership) => membership.userId) },
    })
      .select("firstName lastName email profilePic")
      .lean();
    const usersById = new Map(users.map((user) => [String(user._id), user]));

    return res.status(200).json({
      success: true,
      data: memberships.map((membership) => {
        const user = usersById.get(String(membership.userId));

        return {
          id: String(membership._id),
          userId: String(membership.userId),
          firstName: user?.firstName ?? "",
          lastName: user?.lastName ?? "",
          email: user?.email ?? "",
          profilePic: user?.profilePic ?? "",
          role: membership.role,
          joinedAt: membership.createdAt,
        };
      }),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/orgs/:organizationSlug/members
 */
router.post(
  "/",
  authorize("membership.create"),
  memberAddRateLimit,
  validate({
    body: z.strictObject(
      {
        email: teamEmailSchema,
        role: z
          .string({ error: "role must be ADMIN or MANAGER." })
          .refine((role) => teamRoles.includes(role), {
            message: "role must be ADMIN or MANAGER.",
          }),
      },
      { error: "Only email and role can be provided." },
    ),
  }),
  async (req, res, next) => {
    try {
      const body = req.body;
      const email = body.email.trim().toLowerCase();

      const account = await findAuthAccount(email);
      if (account?.emailVerified) {
        const user = await ensureUserProfile({
          id: String(account._id),
          email,
          name: account.name,
        });
        const session = await mongoose.startSession();
        let membershipId: string | undefined;
        try {
          membershipId = await session.withTransaction(async () => {
            const existing = await Membership.findOne({
              organizationId: req.organizationAccess!.organizationId,
              userId: user._id,
            }).session(session);
            if (existing && existing.role !== ORGANIZATION_ROLES.USER) {
              throw conflict("This person is already a team member. Edit their role in the table.");
            }

            const membership =
              existing ??
              new Membership({
                organizationId: req.organizationAccess!.organizationId,
                userId: user._id,
              });
            membership.role = body.role;
            await membership.save({ session });
            await Invitation.updateMany(
              { organizationId: req.organizationAccess!.organizationId, email, status: "PENDING" },
              { $set: { status: "CANCELLED" } },
              { session },
            );
            return String(membership._id);
          });
        } finally {
          await session.endSession();
        }
        if (!membershipId) throw internalError();
        return res.status(200).json({
          success: true,
          data: { kind: "member", id: membershipId },
        });
      }

      const organization = await Organization.findById(req.organizationAccess!.organizationId)
        .select("name logo primaryColor")
        .lean();
      if (!organization) throw notFound("Organization");

      const pending = await Invitation.findOne({
        organizationId: organization._id,
        email,
        status: "PENDING",
      });
      if (pending) {
        if (pending.expiresAt > new Date()) {
          throw conflict("An invitation is already pending for this email.");
        }
        pending.status = "EXPIRED";
        await pending.save();
      }

      const token = randomBytes(32).toString("hex");
      const invitation = await Invitation.create({
        organizationId: organization._id,
        email,
        role: body.role,
        invitedBy: req.auth!.userId,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const requestOrigin = req.get("origin");
      const frontendOrigin =
        requestOrigin && config.corsOrigins.includes(requestOrigin)
          ? requestOrigin
          : config.corsOrigins[0];
      const url = new URL(`/invitations/${token}`, frontendOrigin).toString();
      try {
        await sendOrganizationInvitationEmail({
          to: email,
          organizationName: organization.name.replace(/[\r\n]/g, " "),
          organizationColor: organization.primaryColor,
          organizationLogo: organization.logo,
          role: body.role === ORGANIZATION_ROLES.ADMIN ? "Admin" : "Manager",
          url,
        });
      } catch (error) {
        await invitation.deleteOne();
        throw error;
      }

      return res.status(201).json({
        success: true,
        data: { kind: "invited", id: String(invitation._id) },
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
