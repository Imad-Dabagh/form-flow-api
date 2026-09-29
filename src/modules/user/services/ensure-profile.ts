import User from "#app/modules/user/models/index";

export async function ensureUserProfile(authUser: {
  id: string;
  email: string;
  name?: string | null;
}) {
  let user = await User.findOne({ authUserId: authUser.id }).select("_id").lean();

  if (!user) {
    try {
      user = await User.create({
        authUserId: authUser.id,
        email: authUser.email,
        firstName: authUser.name?.trim() || authUser.email.split("@", 1)[0],
      });
    } catch (error) {
      user = await User.findOne({ authUserId: authUser.id }).select("_id").lean();
      if (!user) throw error;
    }
  }

  return user;
}
