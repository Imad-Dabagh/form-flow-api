import { fromNodeHeaders } from "better-auth/node";
import type { RequestHandler } from "express";
import type { Auth } from "../auth/index.js";
import { isSuperAdminEmail } from "../lib/platform-admins.js";
import { ensureUserProfile } from "../modules/user/services/index.js";

export default function createAttachSession(auth: Auth): RequestHandler {
  return async (req, _res, next) => {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });

      if (!session || !session.user.emailVerified) {
        return next();
      }

      const authUserId = session.user.id;
      const email = session.user.email.trim().toLowerCase();
      const user = await ensureUserProfile({ id: authUserId, email, name: session.user.name });

      req.auth = {
        userId: String(user._id),
        authUserId,
        email,
        isEmailVerified: session.user.emailVerified,
        isSuperAdmin: isSuperAdminEmail(email),
      };

      return next();
    } catch (error) {
      return next(error);
    }
  };
}
