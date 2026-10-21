import type { RequestHandler } from "express";
import OrganizationModule from "#app/modules/organization/index";
import { AsyncHook } from "#app/services/index";
import type { OrganizationRequestContext } from "#app/types/global";
import { badRequest, notFound } from "#app/utils/errors";

type OrganizationRecord = {
  _id: { toString(): string };
  slug: string;
};

export async function resolveOrganizationBySlug(
  rawSlug: unknown,
  { allowDisabled = false }: { allowDisabled?: boolean } = {},
): Promise<OrganizationRequestContext> {
  const slug = typeof rawSlug === "string" ? rawSlug.trim().toLowerCase() : undefined;

  if (!slug) {
    throw badRequest("An organization slug is required.");
  }

  const organization = (await OrganizationModule.services.fetchOne({
    query: { slug, archivedAt: null, ...(allowDisabled ? {} : { isDisabled: false }) },
    selection: ["_id", "slug"],
  })) as OrganizationRecord | null;

  if (!organization) {
    throw notFound("Organization");
  }

  return {
    organizationId: organization._id.toString(),
    slug: organization.slug,
  };
}

const currentOrganizationBySlug: RequestHandler = async (req, _res, next) => {
  try {
    // Only verified platform administrators retain management access during suspension.
    req.organization = await resolveOrganizationBySlug(req.params.organizationSlug, {
      allowDisabled: req.auth?.isSuperAdmin === true,
    });

    AsyncHook.updateRequestContext({
      currentOrganizationId: req.organization.organizationId,
      currentOrganizationSlug: req.organization.slug,
    });

    return next();
  } catch (error) {
    return next(error);
  }
};

export default currentOrganizationBySlug;
