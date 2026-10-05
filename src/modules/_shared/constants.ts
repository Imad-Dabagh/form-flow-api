export const ORGANIZATION_ROLES = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  USER: "USER",
};

export const COLOR_FAMILIES = {
  BLUE: "blue",
  INDIGO: "indigo",
  PURPLE: "purple",
  PINK: "pink",
  RED: "red",
  ORANGE: "orange",
  AMBER: "amber",
  GREEN: "green",
  EMERALD: "emerald",
  TEAL: "teal",
  SKY: "sky",
} as const;

export const DEFAULT_FORM_SUBMISSION_STATUSES = [
  { name: "Pending", color: COLOR_FAMILIES.ORANGE, order: 1, isDefault: true },
  { name: "In review", color: COLOR_FAMILIES.INDIGO, order: 2 },
  { name: "On Hold", color: COLOR_FAMILIES.AMBER, order: 3 },
  {
    name: "Accepted",
    color: COLOR_FAMILIES.GREEN,
    order: 4,
    isSubmissionLocked: true,
  },
  {
    name: "Rejected",
    color: COLOR_FAMILIES.RED,
    order: 5,
    isSubmissionLocked: true,
  },
] as const;

export const FORM_TYPES = ["PUBLIC", "AUTHENTICATED"] as const;

export type OrganizationPrimaryColor =
  (typeof COLOR_FAMILIES)[keyof typeof COLOR_FAMILIES];
export type FormType = (typeof FORM_TYPES)[number];
