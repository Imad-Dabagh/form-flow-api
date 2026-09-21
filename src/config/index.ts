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

function getCorsOrigins(): string[] | true {
  const configuredOrigins = process.env.CORS_ORIGINS?.trim();

  if (!configuredOrigins) {
    return true;
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
  jwtSecret: requiredEnv("JWT_SECRET"),
  corsOrigins: getCorsOrigins(),
};

export default config;
