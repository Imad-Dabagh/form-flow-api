import type { RequestHandler } from "express";
import OrganizationModule from "../modules/organization/index.js";
import { AsyncHook } from "../services/index.js";
import type { OrganizationRequestContext } from "../types/global.js";
import { badRequest, notFound } from "../utils/errors.js";

type OrganizationRecord = {
  _id: { toString(): string };
  slug: string;
};

export async function resolveOrganizationBySlug(
  rawSlug: unknown,
): Promise<OrganizationRequestContext> {
  const slug = typeof rawSlug === "string" ? rawSlug.trim().toLowerCase() : undefined;

  if (!slug) {
    throw badRequest("An organization slug is required.");
  }

  const organization = (await OrganizationModule.services.fetchOne({
    query: { slug, archivedAt: null },
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
    req.organization = await resolveOrganizationBySlug(
      req.params.organizationSlug,
    );

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
