import type { RequestHandler } from "express";
import OrganizationModule from "../modules/organization";
import { AsyncHook } from "../services";
import { badRequest, notFound } from "../utils/errors";

type OrganizationRecord = {
  _id: { toString(): string };
  slug: string;
};

const currentOrganizationBySlug: RequestHandler = async (req, _res, next) => {
  const rawSlug = req.params.organizationSlug;
  const slug = typeof rawSlug === "string" ? rawSlug.trim().toLowerCase() : undefined;

  if (!slug) {
    return next(badRequest("An organization slug is required."));
  }

  try {
    const organization = (await OrganizationModule.services.fetchOne({
      query: { slug, archivedAt: null },
      selection: ["_id", "slug"],
    })) as OrganizationRecord | null;

    if (!organization) {
      return next(notFound("Organization"));
    }

    req.organization = {
      organizationId: organization._id.toString(),
      slug: organization.slug,
    };
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
