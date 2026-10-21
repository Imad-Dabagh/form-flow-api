import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv/config", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function readConfig() {
  vi.resetModules();
  return (await import("../src/config/index.js")).default;
}

describe("server configuration", () => {
  it("defaults to no proxy trust even in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUST_PROXY", undefined);
    vi.stubEnv("SHUTDOWN_TIMEOUT_MS", undefined);
    const config = await readConfig();
    expect(config.trustProxy).toBe(false);
    expect(config.shutdownTimeoutMs).toBe(30_000);
  });

  it.each([
    ["false", false],
    ["1", 1],
    ["0", 0],
    ["127.0.0.1, 10.0.0.0/8, ::1/128", ["127.0.0.1", "10.0.0.0/8", "::1/128"]],
    ["loopback", ["loopback"]],
  ])("parses the explicit proxy boundary %s", async (input, expected) => {
    vi.stubEnv("TRUST_PROXY", input as string);
    expect((await readConfig()).trustProxy).toEqual(expected);
  });

  it.each([
    "true",
    "-1",
    "1.5",
    "99999999999999999999",
    "10.0.0.0/33",
    "::1/129",
    "127.0.0.1,",
    "proxy.example.com",
  ])("rejects invalid or unrestricted proxy setting %s", async (value) => {
    vi.stubEnv("TRUST_PROXY", value);
    await expect(readConfig()).rejects.toThrow("TRUST_PROXY");
  });

  it("accepts a custom shutdown deadline", async () => {
    vi.stubEnv("SHUTDOWN_TIMEOUT_MS", "45000");
    expect((await readConfig()).shutdownTimeoutMs).toBe(45_000);
  });

  it.each(["0", "-1", "1.5", "NaN", "2147483648"])(
    "rejects invalid shutdown deadline %s",
    async (value) => {
      vi.stubEnv("SHUTDOWN_TIMEOUT_MS", value);
      await expect(readConfig()).rejects.toThrow("SHUTDOWN_TIMEOUT_MS");
    },
  );
});
