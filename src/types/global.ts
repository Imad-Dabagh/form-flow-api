import type { MembershipRole } from "../modules/membership/types";

export interface AuthenticatedRequestUser {
  userId: string;
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
