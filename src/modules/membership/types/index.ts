import { ORGANIZATION_ROLES } from "#app/modules/_shared/constants";

export type MembershipRole =
  (typeof ORGANIZATION_ROLES)[keyof typeof ORGANIZATION_ROLES];
