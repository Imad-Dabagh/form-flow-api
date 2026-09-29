import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import { createHash, randomBytes } from "node:crypto";
import config from "../../config/index.js";
import {
  authenticate,
  authorize,
  currentOrganizationBySlug,
  organizationAccess,
} from "../../middlewares/index.js";
import {
  ORGANIZATION_PRIMARY_COLORS,
  ORGANIZATION_ROLES,
  type OrganizationPrimaryColor,
} from "../../modules/_shared/constants.js";
import Invitation from "../../modules/invitation/models/index.js";
import Membership from "../../modules/membership/models/index.js";
import Organization from "../../modules/organization/models/index.js";
import User from "../../modules/user/models/index.js";
import { ensureUserProfile } from "../../modules/user/services/index.js";
import { sendOrganizationInvitationEmail } from "../../services/email/index.js";
import {
  badRequest,
  conflict,
  internalError,
  notFound,
  tooManyRequests,
} from "../../utils/errors.js";
import { optionalHttpsUrl } from "../../utils/request-values.js";

const router = Router();
const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ORGANIZATION_ROLE_PRIORITY: Record<string, number> = {
  [ORGANIZATION_ROLES.ADMIN]: 0,
  [ORGANIZATION_ROLES.MANAGER]: 1,
  [ORGANIZATION_ROLES.USER]: 2,
};
const organizationPrimaryColors = Object.values(ORGANIZATION_PRIMARY_COLORS);
const editableOrganizationFields = new Set([
  "name",
  "logo",
  "primaryColor",
  "slogan",
  "shortDescription",
]);
const teamRoles = [ORGANIZATION_ROLES.ADMIN, ORGANIZATION_ROLES.MANAGER];
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

function normalizeTeamEmail(value: unknown): string {
  if (typeof value !== "string") throw badRequest("A valid email is required.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest("A valid email is required.");
  }
  return email;
}

async function findAuthAccount(email: string) {
  const database = mongoose.connection.db;
  if (!database) throw internalError();
  return database.collection<{
    email: string;
    emailVerified: boolean;
    name?: string;
    image?: string;
  }>("user").findOne({ email });
}

async function requireAnotherAdmin(
  organizationId: string,
  membershipId: string,
  session: mongoose.ClientSession,
) {
  const otherAdminExists = await Membership.exists({
    organizationId,
    _id: { $ne: membershipId },
    role: ORGANIZATION_ROLES.ADMIN,
  }).session(session);

  if (!otherAdminExists) {
    throw conflict("An organization must keep at least one admin.");
  }
}

async function lockOrganizationMemberships(organizationId: string, session: mongoose.ClientSession) {
  // Role changes in the same organization must serialize before checking the last admin.
  const result = await Organization.updateOne(
    { _id: organizationId, archivedAt: null },
    { $inc: { membershipRevision: 1 } },
    { session },
  );
  if (!result.matchedCount) throw notFound("Organization");
}

function getBody(req: { body: unknown }): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw badRequest("A JSON object is required.");
  }

  return req.body as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];

  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${field} is required.`);
  }

  return value.trim();
}

function editableText(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
): string {
  const value = body[field];

  if (typeof value !== "string") {
    throw badRequest(`${field} must be a string.`);
  }

  const text = value.trim();
  if (text.length > maxLength) {
    throw badRequest(`${field} must be ${maxLength} characters or fewer.`);
  }

  return text;
}

function getPrimaryColor(
  body: Record<string, unknown>,
): OrganizationPrimaryColor {
  const value = body.primaryColor ?? ORGANIZATION_PRIMARY_COLORS.BLUE;

  if (
    typeof value !== "string" ||
    !organizationPrimaryColors.includes(value as OrganizationPrimaryColor)
  ) {
    throw badRequest(
      `primaryColor must be one of: ${organizationPrimaryColors.join(", ")}.`,
    );
  }

  return value as OrganizationPrimaryColor;
}

function normalizePrimaryColor(value?: string): OrganizationPrimaryColor {
  return organizationPrimaryColors.includes(value as OrganizationPrimaryColor)
    ? (value as OrganizationPrimaryColor)
    : ORGANIZATION_PRIMARY_COLORS.BLUE;
}

function toOrganizationResponse(organization: {
  _id: unknown;
  name: string;
  slug: string;
  logo?: string;
  primaryColor?: string;
  slogan?: string;
  shortDescription?: string;
}): Record<string, string> {
  return {
    id: String(organization._id),
    name: organization.name,
    slug: organization.slug,
    logo: organization.logo ?? "",
    primaryColor: normalizePrimaryColor(organization.primaryColor),
    slogan: organization.slogan ?? "",
    shortDescription: organization.shortDescription ?? "",
  };
}

function activeOrganizationQuery() {
  return { archivedAt: null, isDisabled: false };
}

/**
 * GET /api/orgs
 */
router.get("/", authenticate, async (req, res, next) => {
  try {
    if (req.auth!.isSuperAdmin) {
      const [organizations, memberships] = await Promise.all([
        Organization.find({ archivedAt: null })
          .select("name slug logo primaryColor slogan shortDescription")
          .sort({ createdAt: 1 }),
        Membership.find({ userId: req.auth!.userId })
          .select("role organizationId")
          .lean(),
      ]);
      const roleByOrganizationId = new Map<string, string>(
        memberships.map((membership): [string, string] => [
          String(membership.organizationId),
          membership.role,
        ]),
      );

      return res.status(200).json({
        success: true,
        data: organizations.map((organization) => ({
          ...toOrganizationResponse(organization),
          role: roleByOrganizationId.get(String(organization._id)) ?? null,
        })),
      });
    }

    const memberships = await Membership.find({ userId: req.auth!.userId })
      .select("role organizationId")
      .populate({
        path: "organizationId",
        match: activeOrganizationQuery(),
        select: "name slug logo primaryColor slogan shortDescription",
      })
      .sort({ createdAt: 1 });

    memberships.sort(
      (left, right) =>
        ORGANIZATION_ROLE_PRIORITY[left.role] -
        ORGANIZATION_ROLE_PRIORITY[right.role],
    );

    const organizations = memberships.flatMap((membership) => {
      const organization = membership.organizationId;

      if (
        !organization ||
        typeof organization !== "object" ||
        !("_id" in organization)
      ) {
        return [];
      }

      return [
        {
          ...toOrganizationResponse(
            organization as {
              _id: unknown;
              name: string;
              slug: string;
              logo?: string;
              primaryColor?: string;
              slogan?: string;
              shortDescription?: string;
            },
          ),
          role: membership.role,
        },
      ];
    });

    return res.status(200).json({ success: true, data: organizations });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/orgs
 */
router.post("/", authenticate, async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const body = getBody(req);
    const name = requiredString(body, "name");
    const slug = requiredString(body, "slug").toLowerCase();
    const primaryColor = getPrimaryColor(body);
    const logo = optionalHttpsUrl(body, "logo");

    if (name.length > 50) {
      throw badRequest("name must be 50 characters or fewer.");
    }

    if (!ORGANIZATION_SLUG_PATTERN.test(slug)) {
      throw badRequest(
        "slug must use lowercase letters, numbers, and single hyphens only.",
      );
    }

    if (slug.length > 20) {
      throw badRequest("slug must be 20 characters or fewer.");
    }

    const organization = await session.withTransaction(async () => {
      const slugAlreadyInUse = await Organization.exists({ slug }).session(
        session,
      );

      if (slugAlreadyInUse) {
        throw conflict("This organization slug is already in use.");
      }

      const [createdOrganization] = await Organization.create(
        [{ name, slug, primaryColor, ...(logo !== undefined ? { logo } : {}) }],
        { session },
      );
      await Membership.create(
        [
          {
            userId: req.auth!.userId,
            organizationId: createdOrganization._id,
            role: ORGANIZATION_ROLES.ADMIN,
          },
        ],
        { session },
      );
      await User.updateOne(
        { _id: req.auth!.userId, onboardingCompletedAt: null },
        { $set: { onboardingCompletedAt: new Date() } },
        { session },
      );

      return createdOrganization;
    });

    if (!organization) {
      throw internalError();
    }

    return res.status(201).json({
      success: true,
      data: {
        ...toOrganizationResponse(organization),
        role: ORGANIZATION_ROLES.ADMIN,
      },
    });
  } catch (error) {
    return next(error);
  } finally {
    await session.endSession();
  }
});

/**
 * GET /api/orgs/:organizationSlug/members
 */
router.get(
  "/:organizationSlug/members",
  authenticate,
  currentOrganizationBySlug,
  organizationAccess,
  authorize("membership.read"),
  async (req, res, next) => {
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
  },
);

/**
 * GET /api/orgs/:organizationSlug/members/lookup?email=...
 */
router.get(
  "/:organizationSlug/members/lookup",
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

/**
 * POST /api/orgs/:organizationSlug/members
 */
router.post(
  "/:organizationSlug/members",
  authenticate,
  memberAddRateLimit,
  currentOrganizationBySlug,
  organizationAccess,
  authorize("membership.create"),
  async (req, res, next) => {
    try {
      const body = getBody(req);
      if (Object.keys(body).some((field) => field !== "email" && field !== "role")) {
        throw badRequest("Only email and role can be provided.");
      }
      const email = normalizeTeamEmail(body.email);
      if (typeof body.role !== "string" || !teamRoles.includes(body.role)) {
        throw badRequest("role must be ADMIN or MANAGER.");
      }

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

            const membership = existing ?? new Membership({
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
        .select("name slug")
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
      const frontendOrigin = requestOrigin && config.corsOrigins.includes(requestOrigin)
        ? requestOrigin
        : config.corsOrigins[0];
      const url = new URL(`/invitations/${token}`, frontendOrigin).toString();
      try {
        await sendOrganizationInvitationEmail({
          to: email,
          organizationName: organization.name.replace(/[\r\n]/g, " "),
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

/**
 * PUT /api/orgs/:organizationSlug/members/:membershipId
 */
router.put(
  "/:organizationSlug/members/:membershipId",
  authenticate,
  currentOrganizationBySlug,
  organizationAccess,
  authorize("membership.update"),
  async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
      const { membershipId } = req.params;
      if (typeof membershipId !== "string" || !mongoose.isValidObjectId(membershipId)) {
        throw badRequest("A valid membership ID is required.");
      }

      const body = getBody(req);
      if (Object.keys(body).length !== 1 || !teamRoles.includes(body.role as string)) {
        throw badRequest("role must be ADMIN or MANAGER.");
      }

      const result = await session.withTransaction(async () => {
        await lockOrganizationMemberships(req.organizationAccess!.organizationId, session);
        const membership = await Membership.findOne({
          _id: membershipId,
          organizationId: req.organizationAccess!.organizationId,
          role: { $in: teamRoles },
        }).session(session);
        if (!membership) throw notFound("Membership");

        if (membership.role === ORGANIZATION_ROLES.ADMIN && body.role !== ORGANIZATION_ROLES.ADMIN) {
          await requireAnotherAdmin(req.organizationAccess!.organizationId, membershipId, session);
        }

        membership.role = body.role as typeof membership.role;
        await membership.save({ session });
        return { id: String(membership._id), role: membership.role };
      });
      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      return next(error);
    } finally {
      await session.endSession();
    }
  },
);

/**
 * DELETE /api/orgs/:organizationSlug/members/:membershipId
 */
router.delete(
  "/:organizationSlug/members/:membershipId",
  authenticate,
  currentOrganizationBySlug,
  organizationAccess,
  authorize("membership.delete"),
  async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
      const { membershipId } = req.params;
      if (typeof membershipId !== "string" || !mongoose.isValidObjectId(membershipId)) {
        throw badRequest("A valid membership ID is required.");
      }

      await session.withTransaction(async () => {
        await lockOrganizationMemberships(req.organizationAccess!.organizationId, session);
        const membership = await Membership.findOne({
          _id: membershipId,
          organizationId: req.organizationAccess!.organizationId,
          role: { $in: teamRoles },
        }).session(session);
        if (!membership) throw notFound("Membership");

        if (membership.role === ORGANIZATION_ROLES.ADMIN) {
          await requireAnotherAdmin(req.organizationAccess!.organizationId, membershipId, session);
        }

        await membership.deleteOne({ session });
      });
      return res.status(200).json({ success: true, data: { id: membershipId } });
    } catch (error) {
      return next(error);
    } finally {
      await session.endSession();
    }
  },
);

/**
 * PUT /api/orgs/:organizationSlug
 */
router.put(
  "/:organizationSlug",
  authenticate,
  currentOrganizationBySlug,
  organizationAccess,
  authorize("organization.update"),
  async (req, res, next) => {
    try {
      const body = getBody(req);
      const fields = Object.keys(body);

      if (
        !fields.length ||
        fields.some((field) => !editableOrganizationFields.has(field))
      ) {
        throw badRequest(
          "Only name, logo, primaryColor, slogan, and shortDescription can be updated.",
        );
      }

      const updates: Record<string, string> = {};

      if ("name" in body) {
        const name = requiredString(body, "name");
        if (name.length > 50) {
          throw badRequest("name must be 50 characters or fewer.");
        }
        updates.name = name;
      }
      if ("logo" in body) {
        const logo = optionalHttpsUrl(body, "logo");
        if (logo === undefined) throw badRequest("logo must be a URL.");
        updates.logo = logo;
      }
      if ("primaryColor" in body) updates.primaryColor = getPrimaryColor(body);
      if ("slogan" in body) updates.slogan = editableText(body, "slogan", 120);
      if ("shortDescription" in body) {
        updates.shortDescription = editableText(body, "shortDescription", 500);
      }

      const organization = await Organization.findOneAndUpdate(
        { _id: req.organizationAccess!.organizationId, archivedAt: null },
        { $set: updates },
        { new: true, runValidators: true },
      );

      if (!organization) throw notFound("Organization");

      return res.status(200).json({
        success: true,
        data: toOrganizationResponse(organization),
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
