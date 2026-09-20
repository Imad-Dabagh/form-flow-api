import type { MembershipRole } from "../../modules/membership/types";
import { ABILITIES, type Ability } from "./abilities";

export const ROLE_ABILITIES: Record<MembershipRole, readonly Ability[]> = {
  ADMIN: ABILITIES,
  MANAGER: [
    "organization.read",
    "user.read",
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
  ],
  // Reserved for future participant permissions. Users have no active abilities yet.
  USER: [],
};

export function hasAbility(role: MembershipRole, ability: Ability): boolean {
  return ROLE_ABILITIES[role].includes(ability);
}
