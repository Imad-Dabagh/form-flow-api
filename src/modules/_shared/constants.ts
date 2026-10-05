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

export const FORM_TYPES = ["PUBLIC", "AUTHENTICATED"] as const;

export type OrganizationPrimaryColor =
  (typeof COLOR_FAMILIES)[keyof typeof COLOR_FAMILIES];
export type FormType = (typeof FORM_TYPES)[number];
