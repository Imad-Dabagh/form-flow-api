export const ABILITIES = [
  "organization.read",
  "organization.update",
  "user.read",
  "user.create",
  "user.update",
  "user.delete",
  "form.read",
  "form.create",
  "form.update",
  "form.delete",
  "stage.read",
  "stage.create",
  "stage.update",
  "stage.delete",
  "submission.read",
  "submission.create",
  "submission.update",
  "submission.delete",
] as const;

export type Ability = (typeof ABILITIES)[number];
