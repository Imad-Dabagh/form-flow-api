import { ORGANIZATION_ROLES } from "../../_shared/constants.js";

export type MembershipRole =
  (typeof ORGANIZATION_ROLES)[keyof typeof ORGANIZATION_ROLES];
