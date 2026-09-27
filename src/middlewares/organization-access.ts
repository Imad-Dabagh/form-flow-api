import type { RequestHandler } from "express";
import MembershipModule from "../modules/membership/index.js";
import { AsyncHook } from "../services/index.js";
import type {
  AuthenticatedRequestUser,
  OrganizationAccessContext,
  OrganizationRequestContext,
} from "../types/global.js";
import { unauthenticated, unauthorized } from "../utils/errors.js";

type MembershipRecord = {
  role: "ADMIN" | "MANAGER" | "USER";
};

export async function resolveOrganizationAccess(
  auth: AuthenticatedRequestUser,
  organization: OrganizationRequestContext,
): Promise<OrganizationAccessContext> {
  if (auth.isSuperAdmin) {
    return {
      ...organization,
      isSuperAdmin: true,
    };
  }

  const membership = (await MembershipModule.services.fetchOne({
    query: {
      userId: auth.userId,
      organizationId: organization.organizationId,
    },
    selection: ["role"],
  })) as MembershipRecord | null;

  if (!membership) {
    throw unauthorized();
  }

  return {
    ...organization,
    isSuperAdmin: false,
    membershipRole: membership.role,
  };
}

const organizationAccess: RequestHandler = async (req, _res, next) => {
  if (!req.auth) {
    return next(unauthenticated());
  }

  if (!req.organization) {
    return next(unauthorized());
  }

  try {
    req.organizationAccess = await resolveOrganizationAccess(
      req.auth,
      req.organization,
    );

    if (req.organizationAccess.isSuperAdmin) {
      AsyncHook.updateRequestContext({ isSuperAdmin: true });
    } else {
      AsyncHook.updateRequestContext({
        membershipRole: req.organizationAccess.membershipRole,
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
};

export default organizationAccess;
