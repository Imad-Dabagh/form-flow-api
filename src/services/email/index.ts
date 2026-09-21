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
