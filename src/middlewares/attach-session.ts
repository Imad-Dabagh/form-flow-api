import { fromNodeHeaders } from "better-auth/node";
import type { RequestHandler } from "express";
import type { Auth } from "../auth/index.js";
import User from "../modules/user/models/index.js";

function getInitialFirstName(email: string, name?: string | null): string {
  return name?.trim() || email.split("@", 1)[0];
}

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
      let user = await User.findOne({ authUserId }).select("_id").lean();

      if (!user) {
        try {
          user = await User.create({
            authUserId,
            email,
            firstName: getInitialFirstName(email, session.user.name),
          });
        } catch (error) {
          user = await User.findOne({ authUserId }).select("_id").lean();

          if (!user) {
            throw error;
          }
        }
      }

      req.auth = {
        userId: String(user._id),
        authUserId,
        email,
        isEmailVerified: session.user.emailVerified,
      };

      return next();
    } catch (error) {
      return next(error);
    }
  };
}
