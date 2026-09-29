import type { RequestHandler } from "express";
import { AsyncHook } from "#app/services/index";
import { unauthenticated } from "#app/utils/errors";
import { resolveOrganizationBySlug } from "./current-organization-by-slug.js";
import { resolveOrganizationAccess } from "./organization-access.js";

const resolveUploadTenant: RequestHandler = async (req, _res, next) => {
  if (!req.auth) {
    return next(unauthenticated());
  }

  try {
    const organizationSlug = req.get("x-organization-slug")?.trim();

    if (!organizationSlug) {
      req.uploadTenantId = req.auth.isSuperAdmin
        ? "platform"
        : `user-${req.auth.userId}`;
      return next();
    }

    req.organization = await resolveOrganizationBySlug(organizationSlug);
    req.organizationAccess = await resolveOrganizationAccess(
      req.auth,
      req.organization,
    );
    req.uploadTenantId = `organization-${req.organization.organizationId}`;

    AsyncHook.updateRequestContext({
      currentOrganizationId: req.organization.organizationId,
      currentOrganizationSlug: req.organization.slug,
      ...(req.organizationAccess.isSuperAdmin
        ? { isSuperAdmin: true }
        : { membershipRole: req.organizationAccess.membershipRole }),
    });

    return next();
  } catch (error) {
    return next(error);
  }
};

export default resolveUploadTenant;
