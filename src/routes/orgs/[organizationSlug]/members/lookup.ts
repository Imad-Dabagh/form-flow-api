import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import InvitationModule from "#app/modules/invitation/index";
import MembershipModule from "#app/modules/membership/index";
import UserModule from "#app/modules/user/index";
import { tooManyRequests } from "#app/utils/errors";
import { findAuthAccount, teamEmailSchema } from "#app/utils/organization-routes";

const router = Router({ mergeParams: true });

const memberLookupRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 120,
  identifier: "organization-member-lookup",
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.auth!.userId,
  handler: (_req, _res, next) =>
    next(tooManyRequests("Email lookup limit reached. Try again later.")),
});

/**
 * GET /api/orgs/:organizationSlug/members/lookup?email=...
 */
router.get(
  "/",
  authorize("membership.read"),
  memberLookupRateLimit,
  validate({ query: z.object({ email: teamEmailSchema }) }),
  async (req, res, next) => {
    try {
      const email = (req.query.email as string).trim().toLowerCase();
      const account = await findAuthAccount(email);
      if (!account?.emailVerified) {
        const pending = (await InvitationModule.services.fetchOne({
          query: {
            organizationId: req.organizationAccess!.organizationId,
            email,
            status: "PENDING",
            expiresAt: { $gt: new Date() },
          },
          selection: "role",
        })) as { role: string } | null;
        if (pending) {
          return res.status(200).json({
            success: true,
            data: { kind: "pending", email, role: pending.role },
          });
        }
        return res.status(200).json({ success: true, data: { kind: "invite", email } });
      }

      const user = (await UserModule.services.fetchOne({
        query: { authUserId: String(account._id) },
        selection: "_id firstName lastName profilePic",
      })) as { _id: unknown; firstName?: string; lastName?: string; profilePic?: string } | null;
      const membership = user
        ? ((await MembershipModule.services.fetchOne({
            query: { organizationId: req.organizationAccess!.organizationId, userId: user._id },
            selection: "role",
          })) as { role: string } | null)
        : null;

      return res.status(200).json({
        success: true,
        data: {
          kind: "existing",
          email,
          name:
            [user?.firstName, user?.lastName].filter(Boolean).join(" ") || account.name || email,
          profilePic: user?.profilePic || account.image || "",
          currentRole: membership?.role ?? null,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
