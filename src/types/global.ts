import type { MembershipRole } from "../modules/membership/types/index.js";

export interface AuthenticatedRequestUser {
  userId: string;
  authUserId: string;
  email: string;
  isEmailVerified: boolean;
}

export interface OrganizationRequestContext {
  organizationId: string;
  slug: string;
}

export interface OrganizationAccessContext extends OrganizationRequestContext {
  isSuperAdmin: boolean;
  membershipRole?: MembershipRole;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedRequestUser;
      organization?: OrganizationRequestContext;
      organizationAccess?: OrganizationAccessContext;
    }
  }
}

export {};
