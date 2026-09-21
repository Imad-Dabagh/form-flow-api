import type { RequestHandler } from "express";
import MembershipModule from "../modules/membership/index.js";
import UserModule from "../modules/user/index.js";
import { AsyncHook } from "../services/index.js";
import { unauthenticated, unauthorized } from "../utils/errors.js";

type UserRecord = {
  platformRoles?: string[];
};

type MembershipRecord = {
  role: "ADMIN" | "MANAGER" | "USER";
};

const organizationAccess: RequestHandler = async (req, _res, next) => {
  if (!req.auth) {
    return next(unauthenticated());
  }

  if (!req.organization) {
    return next(unauthorized());
  }

  try {
    const user = (await UserModule.services.fetchById({
      id: req.auth.userId,
      selection: ["platformRoles"],
    })) as UserRecord | null;

    if (!user) {
      return next(unauthenticated());
    }

    const isSuperAdmin = user.platformRoles?.includes("SUPER_ADMIN") ?? false;
    if (isSuperAdmin) {
      req.organizationAccess = {
        ...req.organization,
        isSuperAdmin: true,
      };
      AsyncHook.updateRequestContext({ isSuperAdmin: true });
      return next();
    }

    const membership = (await MembershipModule.services.fetchOne({
      query: {
        userId: req.auth.userId,
        organizationId: req.organization.organizationId,
      },
      selection: ["role"],
    })) as MembershipRecord | null;

    if (!membership) {
      return next(unauthorized());
    }

    req.organizationAccess = {
      ...req.organization,
      isSuperAdmin: false,
      membershipRole: membership.role,
    };
    AsyncHook.updateRequestContext({ membershipRole: membership.role });

    return next();
  } catch (error) {
    return next(error);
  }
};

export default organizationAccess;
