import { organizationBrand, renderActionEmail, type ActionLinkInput } from "./render-email.js";

// The organization name, color, and logo are captured when the invitation is sent.

export interface OrganizationInvitationEmailInput extends ActionLinkInput {
  organizationName: string;
  organizationColor?: string;
  organizationLogo?: string;
  role: "Admin" | "Manager";
}

export function organizationInvitationEmail(input: OrganizationInvitationEmailInput) {
  const brand = organizationBrand({
    name: input.organizationName,
    primaryColor: input.organizationColor,
    logo: input.organizationLogo,
  });
  const role = input.role === "Admin" ? "an admin" : "a manager";

  return renderActionEmail({
    to: input.to,
    url: input.url,
    brand,
    subject: `Invitation to join ${brand.name} on Form Flow`,
    preheader: `${brand.name} invited you to join their team.`,
    heading: `You're invited to ${brand.name}`,
    paragraphs: [
      `You have been invited to join ${brand.name} as ${role}.`,
      `Sign in with ${input.to} to review and accept your invitation.`,
    ],
    actionLabel: "Review invitation",
    afterAction: ["This invitation expires in 7 days."],
  });
}
