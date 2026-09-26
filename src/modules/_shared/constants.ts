export const ORGANIZATION_ROLES = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  USER: "USER",
};

export const ORGANIZATION_PRIMARY_COLORS = {
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

export type OrganizationPrimaryColor =
  (typeof ORGANIZATION_PRIMARY_COLORS)[keyof typeof ORGANIZATION_PRIMARY_COLORS];
