import type { RequestHandler } from "express";
import { hasAbility, type Ability } from "../lib/permissions";
import { unauthorized } from "../utils/errors";

/**
 * Requires at least one declared ability. Routes must run authenticate,
 * currentOrganizationBySlug, and organizationAccess before this middleware.
 */
export default function authorize(...requiredAbilities: Ability[]): RequestHandler {
  return (req, _res, next) => {
    const access = req.organizationAccess;

    if (!access) {
      return next(unauthorized());
    }

    if (access.isSuperAdmin) {
      return next();
    }

    const role = access.membershipRole;
    if (!role || !requiredAbilities.some((ability) => hasAbility(role, ability))) {
      return next(unauthorized());
    }

    return next();
  };
}
