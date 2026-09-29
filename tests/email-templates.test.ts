import { describe, expect, it } from "vitest";
import {
  magicLinkEmail,
  passwordResetEmail,
  verificationEmail,
} from "../src/services/email/account-email-templates.js";
import { organizationInvitationEmail } from "../src/services/email/organization-invitation-template.js";

const action = {
  to: "person@example.com",
  url: "https://formflow.example/action?token=one&next=two",
};

describe("email templates", () => {
  it.each([
    [verificationEmail, "Verify email"],
    [passwordResetEmail, "Reset password"],
    [magicLinkEmail, "Sign in"],
  ])("renders an app email with HTML and plain text", (template, label) => {
    const email = template(action);

    expect(email.html).toContain("Form Flow");
    expect(email.html).toContain("#047857");
    expect(email.html).toContain("https://formflow.example/action?token=one&amp;next=two");
    expect(email.html).toContain(label);
    expect(email.text).toContain(`${label}: ${action.url}`);
    expect(email.text).toContain("If you did not request this");
  });

  it("renders organization branding, role, and expiration", () => {
    const email = organizationInvitationEmail({
      ...action,
      organizationName: "Acme",
      organizationColor: "purple",
      organizationLogo: "https://cdn.example.com/logo.png?size=1&fit=contain",
      role: "Admin",
    });

    expect(email.subject).toBe("Invitation to join Acme on Form Flow");
    expect(email.html).toContain("#7e22ce");
    expect(email.html).toContain('src="https://cdn.example.com/logo.png?size=1&amp;fit=contain"');
    expect(email.html).toContain("Acme");
    expect(email.text).toContain("as an admin");
    expect(email.text).toContain("expires in 7 days");
    expect(email.text).toContain("Sent through Form Flow");
  });

  it("escapes organization content and falls back for unsupported branding", () => {
    const email = organizationInvitationEmail({
      ...action,
      organizationName: "Acme <script>alert(1)</script>\r\nTeam",
      organizationColor: "unknown",
      organizationLogo: "javascript:alert(1)",
      role: "Manager",
    });

    expect(email.subject).toBe("Invitation to join Acme <script>alert(1)</script> Team on Form Flow");
    expect(email.html).toContain("Acme &lt;script&gt;alert(1)&lt;/script&gt; Team");
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("#1d4ed8");
    expect(email.text).toContain("as a manager");
  });

  it("rejects unsafe action links", () => {
    expect(() => verificationEmail({ ...action, url: "javascript:alert(1)" })).toThrow(
      "Email action URL must use HTTP or HTTPS.",
    );
  });
});
