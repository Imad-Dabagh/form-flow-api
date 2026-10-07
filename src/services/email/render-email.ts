import type { OrganizationPrimaryColor } from "#app/modules/_shared/constants";

// Shared presentation: templates choose a brand and supply copy; this file renders both formats.
interface EmailBrand {
  name: string;
  accent: string;
  logoUrl?: string;
  footer: string;
}

// Email colors use hex values and inline styles so they work across email clients.
// Darker shades keep white text readable on buttons for every organization color.
const organizationAccents: Record<OrganizationPrimaryColor, string> = {
  blue: "#1d4ed8",
  indigo: "#4338ca",
  purple: "#7e22ce",
  pink: "#be185d",
  red: "#b91c1c",
  orange: "#c2410c",
  amber: "#92400e",
  green: "#15803d",
  emerald: "#047857",
  teal: "#0f766e",
  sky: "#0369a1",
};

export const appBrand: EmailBrand = {
  name: "Form Flow",
  accent: organizationAccents.emerald,
  footer: "Form Flow",
};

export function organizationBrand(input: {
  name: string;
  primaryColor?: string;
  logo?: string;
}): EmailBrand {
  const name = input.name.replace(/\s+/g, " ").trim() || "Organization";
  const color = input.primaryColor;
  const accent =
    color && Object.prototype.hasOwnProperty.call(organizationAccents, color)
      ? organizationAccents[color as OrganizationPrimaryColor]
      : organizationAccents.blue;

  let logoUrl: string | undefined;
  if (input.logo) {
    try {
      const url = new URL(input.logo);
      if (url.protocol === "https:") {
        logoUrl = url.toString();
      }
    } catch {
      // The organization name remains visible when an old logo URL is invalid.
    }
  }

  return { name, accent, logoUrl, footer: "Sent through Form Flow" };
}

export interface EmailContent {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface ActionLinkInput {
  to: string;
  url: string;
}

interface ActionEmailInput extends ActionLinkInput {
  brand: EmailBrand;
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  actionLabel: string;
  afterAction?: string[];
}

interface EmailLayoutInput {
  to: string;
  brand: EmailBrand;
  subject: string;
  preheader: string;
  bodyHtml: string;
  bodyText: string;
}

// Templates pass plain strings; escape them before adding them to HTML.
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function actionUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Email action URL must use HTTP or HTTPS.");
  }
  return url.toString();
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:24px;">${escapeHtml(text)}</p>`;
}

// Keep the outer layout separate so future messages can omit the action button.
function renderEmailLayout(input: EmailLayoutInput): EmailContent {
  const brandName = escapeHtml(input.brand.name);
  const logo = input.brand.logoUrl
    ? `<img src="${escapeHtml(input.brand.logoUrl)}" alt="" width="160" style="display:block;max-width:160px;max-height:48px;width:auto;height:auto;margin:0 0 12px;" />`
    : "";
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-top:4px solid ${input.brand.accent};border-radius:12px;">
      <tr><td style="padding:32px 32px 8px;">${logo}<div style="color:${input.brand.accent};font-size:18px;font-weight:700;line-height:26px;">${brandName}</div></td></tr>
      <tr><td style="padding:16px 32px 32px;">
        ${input.bodyHtml}
      </td></tr>
    </table>
    <p style="margin:20px 0 0;color:#64748b;font-size:12px;line-height:18px;">${escapeHtml(input.brand.footer)}</p>
  </td></tr></table>
</body></html>`;

  const text = [input.brand.name, input.bodyText, input.brand.footer].join("\n\n");

  return { to: input.to, subject: input.subject, html, text };
}

export function renderActionEmail(input: ActionEmailInput): EmailContent {
  const url = actionUrl(input.url);
  const escapedUrl = escapeHtml(url);
  const afterAction = input.afterAction ?? [];
  const bodyHtml = `<h1 style="margin:0 0 24px;color:#0f172a;font-size:26px;line-height:34px;">${escapeHtml(input.heading)}</h1>
        ${input.paragraphs.map(paragraph).join("\n        ")}
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td bgcolor="${input.brand.accent}" style="background:${input.brand.accent};border-radius:8px;"><a href="${escapedUrl}" style="display:inline-block;padding:14px 22px;color:#ffffff;font-size:16px;font-weight:700;line-height:22px;text-decoration:none;">${escapeHtml(input.actionLabel)}</a></td></tr></table>
        ${afterAction.map(paragraph).join("\n        ")}
        <p style="margin:24px 0 0;color:#64748b;font-size:13px;line-height:20px;">If the button does not work, copy this link into your browser:<br /><a href="${escapedUrl}" style="color:${input.brand.accent};word-break:break-all;">${escapedUrl}</a></p>`;
  const bodyText = [
    input.heading,
    ...input.paragraphs,
    `${input.actionLabel}: ${url}`,
    ...afterAction,
  ].join("\n\n");

  return renderEmailLayout({
    to: input.to,
    brand: input.brand,
    subject: input.subject,
    preheader: input.preheader,
    bodyHtml,
    bodyText,
  });
}
