export const ABILITIES = [
  "organization.read",
  "organization.update",
  "membership.read",
  "membership.create",
  "membership.update",
  "membership.delete",
  "user.read",
  "user.create",
  "user.update",
  "user.delete",
  "form.read",
  "form.create",
  "form.update",
  "form.delete",
  "submission.read",
  "submission.create",
  "submission.update",
  "submission.delete",
] as const;

export type Ability = (typeof ABILITIES)[number];
