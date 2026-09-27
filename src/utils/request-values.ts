import { badRequest } from "./errors.js";

const MAX_URL_LENGTH = 2_048;

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
