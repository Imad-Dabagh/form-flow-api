import "dotenv/config";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getPort(): number {
  const port = Number(process.env.PORT ?? 4000);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid port number.");
  }

  return port;
}

function getCorsOrigins(): string[] {
  const configuredOrigins = process.env.CORS_ORIGINS?.trim();

  if (!configuredOrigins) {
    if (env === "development") {
      return ["http://localhost:3000"];
    }

    throw new Error("CORS_ORIGINS is required outside development.");
  }

  return configuredOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const env = process.env.NODE_ENV ?? "development";

const config = {
  env,
  isProduction: env === "production",
  port: getPort(),
  mongoUri: requiredEnv("MONGO_URI"),
  betterAuthSecret: requiredEnv("BETTER_AUTH_SECRET"),
  betterAuthUrl: requiredEnv("BETTER_AUTH_URL"),
  googleClientId: requiredEnv("GOOGLE_CLIENT_ID"),
  googleClientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
  resendApiKey: requiredEnv("RESEND_API_KEY"),
  authEmailFrom: requiredEnv("AUTH_EMAIL_FROM"),
  corsOrigins: getCorsOrigins(),
};

export default config;
