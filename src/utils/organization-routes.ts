import mongoose from "mongoose";
import {
  ORGANIZATION_PRIMARY_COLORS,
  ORGANIZATION_ROLES,
  type OrganizationPrimaryColor,
} from "../modules/_shared/constants.js";
import { badRequest, internalError } from "./errors.js";

const organizationPrimaryColors = Object.values(ORGANIZATION_PRIMARY_COLORS);

export const teamRoles = [ORGANIZATION_ROLES.ADMIN, ORGANIZATION_ROLES.MANAGER];

export function getPrimaryColor(
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

export function toOrganizationResponse(organization: {
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

export function normalizeTeamEmail(value: unknown): string {
  if (typeof value !== "string") throw badRequest("A valid email is required.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest("A valid email is required.");
  }
  return email;
}

export async function findAuthAccount(email: string) {
  const database = mongoose.connection.db;
  if (!database) throw internalError();
  return database.collection<{
    email: string;
    emailVerified: boolean;
    name?: string;
    image?: string;
  }>("user").findOne({ email });
}
