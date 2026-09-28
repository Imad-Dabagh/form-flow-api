import { Resend } from "resend";
import config from "../../config/index.js";
import Logger from "../logger/index.js";

type AuthEmail = {
  to: string;
  subject: string;
  heading: string;
  actionLabel: string;
  url: string;
};

const resend = new Resend(config.resendApiKey);

export async function sendAuthEmail({
  to,
  subject,
  heading,
  actionLabel,
  url,
}: AuthEmail): Promise<void> {
  const result = await resend.emails.send({
    from: config.authEmailFrom,
    to,
    subject,
    text: `${heading}\n\n${actionLabel}: ${url}`,
    html: `<p>${heading}</p><p><a href="${url}">${actionLabel}</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }
}

export function deliverAuthEmail(email: AuthEmail): void {
  void sendAuthEmail(email).catch((error: unknown) => {
    Logger.error("Failed to deliver authentication email", error);
  });
}

export async function sendOrganizationInvitationEmail(input: {
  to: string;
  organizationName: string;
  role: "Admin" | "Manager";
  url: string;
}): Promise<void> {
  const result = await resend.emails.send({
    from: config.authEmailFrom,
    to: input.to,
    subject: `Invitation to join ${input.organizationName} on Form Flow`,
    text: `You have been invited to join ${input.organizationName} as ${input.role}. Sign in with ${input.to} to accept your invitation.\n\n${input.url}\n\nThis invitation expires in 7 days.`,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }
}
