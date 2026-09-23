const SUPER_ADMIN_EMAILS = new Set([
  "imaddabagh@gmail.com",
]);

export function isSuperAdminEmail(email: string): boolean {
  return SUPER_ADMIN_EMAILS.has(email.trim().toLowerCase());
}
