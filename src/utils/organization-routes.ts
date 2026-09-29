import mongoose from "mongoose";
import { z } from "zod";
import {
  ORGANIZATION_PRIMARY_COLORS,
  ORGANIZATION_ROLES,
  type OrganizationPrimaryColor,
} from "../modules/_shared/constants.js";
import { internalError } from "./errors.js";

const organizationPrimaryColors = Object.values(ORGANIZATION_PRIMARY_COLORS);

export const teamRoles = [ORGANIZATION_ROLES.ADMIN, ORGANIZATION_ROLES.MANAGER];

const primaryColorError = `primaryColor must be one of: ${organizationPrimaryColors.join(", ")}.`;

export const primaryColorSchema = z.string({ error: primaryColorError })
  .refine((value) => organizationPrimaryColors.includes(value as OrganizationPrimaryColor), {
    message: primaryColorError,
  });

export const teamEmailSchema = z.string({ error: "A valid email is required." })
  .refine((value) => {
    const email = value.trim().toLowerCase();
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }, { message: "A valid email is required." });

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
