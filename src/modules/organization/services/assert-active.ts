import { notFound } from "#app/utils/errors";
import services from "./default.js";

/** Form participation requires an active organization, regardless of the actor's role. */
export async function assertActiveOrganization(organizationId: string): Promise<void> {
  const active = await services.existsById({
    id: organizationId,
    query: { archivedAt: null, isDisabled: false },
  });

  if (!active) throw notFound("Organization");
}
