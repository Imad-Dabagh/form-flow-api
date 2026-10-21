import { isIP } from "node:net";
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

function getShutdownTimeout(): number {
  const timeout = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 30_000);

  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) {
    throw new Error("SHUTDOWN_TIMEOUT_MS must be a positive integer within Node's timer range.");
  }

  return timeout;
}

function getTrustProxy(): false | number | string[] {
  const value = process.env.TRUST_PROXY?.trim() || "false";
  if (value === "false") return false;

  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (Number.isSafeInteger(hops)) return hops;
  }

  const proxies = value.split(",").map((proxy) => proxy.trim());
  const aliases = new Set(["loopback", "linklocal", "uniquelocal"]);
  const valid = proxies.every((proxy) => {
    if (aliases.has(proxy)) return true;

    const [address, prefix, ...extra] = proxy.split("/");
    const family = isIP(address);
    return (
      family !== 0 &&
      extra.length === 0 &&
      (prefix === undefined ||
        (/^\d+$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128)))
    );
  });

  if (!valid) {
    throw new Error("TRUST_PROXY must be false, a hop count, or a list of proxy IPs/subnets.");
  }

  return proxies;
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
  shutdownTimeoutMs: getShutdownTimeout(),
  trustProxy: getTrustProxy(),
  mongoUri: requiredEnv("MONGO_URI"),
  betterAuthSecret: requiredEnv("BETTER_AUTH_SECRET"),
  betterAuthUrl: requiredEnv("BETTER_AUTH_URL"),
  googleClientId: requiredEnv("GOOGLE_CLIENT_ID"),
  googleClientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
  resendApiKey: requiredEnv("RESEND_API_KEY"),
  authEmailFrom: requiredEnv("AUTH_EMAIL_FROM"),
  cloudinary: {
    cloudName: requiredEnv("CLOUDINARY_CLOUD_NAME"),
    apiKey: requiredEnv("CLOUDINARY_API_KEY"),
    apiSecret: requiredEnv("CLOUDINARY_API_SECRET"),
  },
  corsOrigins: getCorsOrigins(),
};

export default config;
