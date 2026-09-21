import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      MONGO_URI: "mongodb://127.0.0.1:27017/form-flow-test",
      NODE_ENV: "test",
      CORS_ORIGINS: "http://localhost:3000",
      BETTER_AUTH_URL: "http://localhost:4000",
      BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-for-better-auth",
      GOOGLE_CLIENT_ID: "test-google-client-id",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
      RESEND_API_KEY: "re_test",
      AUTH_EMAIL_FROM: "Form Flow <auth@example.com>",
    },
  },
});
