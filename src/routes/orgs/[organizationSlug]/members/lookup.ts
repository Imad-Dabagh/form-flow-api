import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { authenticate, authorize, currentOrganizationBySlug, organizationAccess } from "../../../../middlewares/index.js";
import Invitation from "../../../../modules/invitation/models/index.js";
import Membership from "../../../../modules/membership/models/index.js";
import User from "../../../../modules/user/models/index.js";
import { tooManyRequests } from "../../../../utils/errors.js";
import { findAuthAccount, normalizeTeamEmail } from "../../../../utils/organization-routes.js";

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
  authenticate,
  memberLookupRateLimit,
  currentOrganizationBySlug,
  organizationAccess,
  authorize("membership.read"),
  async (req, res, next) => {
    try {
      const email = normalizeTeamEmail(req.query.email);
      const account = await findAuthAccount(email);
      if (!account?.emailVerified) {
        const pending = await Invitation.findOne({
          organizationId: req.organizationAccess!.organizationId,
          email,
          status: "PENDING",
          expiresAt: { $gt: new Date() },
        }).select("role").lean();
        if (pending) {
          return res.status(200).json({
            success: true,
            data: { kind: "pending", email, role: pending.role },
          });
        }
        return res.status(200).json({ success: true, data: { kind: "invite", email } });
      }

      const user = await User.findOne({ authUserId: String(account._id) })
        .select("_id firstName lastName profilePic")
        .lean();
      const membership = user
        ? await Membership.findOne({
            organizationId: req.organizationAccess!.organizationId,
            userId: user._id,
          }).select("role").lean()
        : null;

      return res.status(200).json({
        success: true,
        data: {
          kind: "existing",
          email,
          name: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || account.name || email,
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
