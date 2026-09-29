import { badRequest } from "./errors.js";

const MAX_URL_LENGTH = 2_048;

export function getBody(req: { body: unknown }): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw badRequest("A JSON object is required.");
  }

  return req.body as Record<string, unknown>;
}

export function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];

  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${field} is required.`);
  }

  return value.trim();
}

export function optionalHttpsUrl(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = body[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw badRequest(`${field} must be a URL.`);
  }

  const url = value.trim();

  if (!url) {
    return "";
  }

  if (url.length > MAX_URL_LENGTH) {
    throw badRequest(`${field} must be ${MAX_URL_LENGTH} characters or fewer.`);
  }

  try {
    if (new URL(url).protocol !== "https:") {
      throw new Error("Invalid protocol");
    }
  } catch {
    throw badRequest(`${field} must be a valid HTTPS URL.`);
  }

  return url;
}
