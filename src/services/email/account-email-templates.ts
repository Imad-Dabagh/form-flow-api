import { appBrand, renderActionEmail, type ActionLinkInput } from "./render-email.js";

// Form Flow account messages: Better Auth supplies the recipient and action URL.

const unexpectedEmailNote = "If you did not request this, you can ignore this email.";

export function verificationEmail(input: ActionLinkInput) {
  return renderActionEmail({
    ...input,
    brand: appBrand,
    subject: "Verify your Form Flow email",
    preheader: "Confirm your email address to continue to Form Flow.",
    heading: "Verify your email address",
    paragraphs: ["Confirm your email address to continue to Form Flow."],
    actionLabel: "Verify email",
    afterAction: [unexpectedEmailNote],
  });
}

export function passwordResetEmail(input: ActionLinkInput) {
  return renderActionEmail({
    ...input,
    brand: appBrand,
    subject: "Reset your Form Flow password",
    preheader: "Use this secure link to reset your password.",
    heading: "Reset your password",
    paragraphs: ["Use the secure link below to choose a new password."],
    actionLabel: "Reset password",
    afterAction: [unexpectedEmailNote],
  });
}

export function magicLinkEmail(input: ActionLinkInput) {
  return renderActionEmail({
    ...input,
    brand: appBrand,
    subject: "Your Form Flow sign-in link",
    preheader: "Use your one-time link to sign in to Form Flow.",
    heading: "Sign in to Form Flow",
    paragraphs: ["Use this one-time link to sign in to your account."],
    actionLabel: "Sign in",
    afterAction: [unexpectedEmailNote],
  });
}
