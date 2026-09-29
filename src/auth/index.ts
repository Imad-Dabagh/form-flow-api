import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import type { Db, MongoClient } from "mongodb";
import config from "../config/index.js";
import {
  deliverMagicLinkEmail,
  deliverPasswordResetEmail,
  deliverVerificationEmail,
} from "../services/email/send-email.js";

export function createAuth(database: Db, client: MongoClient) {
  return betterAuth({
    baseURL: config.betterAuthUrl,
    basePath: "/api/auth",
    secret: config.betterAuthSecret,
    trustedOrigins: config.corsOrigins,
    database: mongodbAdapter(database, { client }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 72,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        deliverPasswordResetEmail({
          to: user.email,
          url,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        deliverVerificationEmail({
          to: user.email,
          url,
        });
      },
    },
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: false,
      },
    },
    user: {
      changeEmail: {
        enabled: false,
      },
    },
    plugins: [
      magicLink({
        disableSignUp: false,
        storeToken: "hashed",
        sendMagicLink: ({ email, url }) => {
          deliverMagicLinkEmail({
            to: email,
            url,
          });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
