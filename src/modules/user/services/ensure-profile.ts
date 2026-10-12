import services from "./default.js";

interface ProfileIdentity {
  _id: unknown;
}

export async function ensureUserProfile(authUser: {
  id: string;
  email: string;
  name?: string | null;
}) {
  let user = (await services.fetchOne({
    query: { authUserId: authUser.id },
    selection: "_id",
  })) as ProfileIdentity | null;

  if (!user) {
    try {
      user = (await services.createOne({
        payload: {
          authUserId: authUser.id,
          email: authUser.email,
          firstName: authUser.name?.trim() || authUser.email.split("@", 1)[0],
        },
      })) as ProfileIdentity;
    } catch (error) {
      user = (await services.fetchOne({
        query: { authUserId: authUser.id },
        selection: "_id",
      })) as ProfileIdentity | null;
      if (!user) throw error;
    }
  }

  return user;
}
