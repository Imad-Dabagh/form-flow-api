import { Resend } from "resend";
import config from "#app/config/index";
import Logger from "#app/services/logger/index";
import {
  magicLinkEmail,
  passwordResetEmail,
  verificationEmail,
} from "./account-email-templates.js";
import {
  organizationInvitationEmail,
  type OrganizationInvitationEmailInput,
} from "./organization-invitation-template.js";
import type { ActionLinkInput, EmailContent } from "./render-email.js";

// Callers choose a message here; templates render it, and this file delivers it.
const resend = new Resend(config.resendApiKey);

async function sendEmail(email: EmailContent): Promise<void> {
  const result = await resend.emails.send({
    from: config.authEmailFrom,
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }
}

// Auth callbacks log delivery failures without waiting for Resend.
function deliverAuthEmail(email: EmailContent): void {
  void sendEmail(email).catch((error: unknown) => {
    Logger.error("Failed to deliver authentication email", error);
  });
}

export function deliverVerificationEmail(input: ActionLinkInput): void {
  deliverAuthEmail(verificationEmail(input));
}

export function deliverPasswordResetEmail(input: ActionLinkInput): void {
  deliverAuthEmail(passwordResetEmail(input));
}

export function deliverMagicLinkEmail(input: ActionLinkInput): void {
  deliverAuthEmail(magicLinkEmail(input));
}

export async function sendOrganizationInvitationEmail(
  input: OrganizationInvitationEmailInput,
): Promise<void> {
  // Invitation creation awaits delivery so the route can remove a failed invitation.
  await sendEmail(organizationInvitationEmail(input));
}
