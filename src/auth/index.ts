import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import type { Db, MongoClient } from "mongodb";
import config from "../config/index.js";
import { deliverAuthEmail } from "../services/email/index.js";

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
        deliverAuthEmail({
          to: user.email,
          subject: "Reset your Form Flow password",
          heading: "Use the secure link below to reset your password.",
          actionLabel: "Reset password",
          url,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        deliverAuthEmail({
          to: user.email,
          subject: "Verify your Form Flow email",
          heading: "Verify your email address to continue to Form Flow.",
          actionLabel: "Verify email",
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
          deliverAuthEmail({
            to: email,
            subject: "Your Form Flow sign-in link",
            heading: "Use this one-time link to sign in to Form Flow.",
            actionLabel: "Sign in",
            url,
          });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
