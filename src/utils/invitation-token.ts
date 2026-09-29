import { createHash } from "node:crypto";
import { badRequest } from "./errors.js";

export function getTokenHash(token: unknown): string {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    throw badRequest("A valid invitation link is required.");
  }
  return createHash("sha256").update(token).digest("hex");
}
