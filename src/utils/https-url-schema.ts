import { z } from "zod";

/** Shared by profile and organization image URL fields, which also allow clearing with "". */
export function httpsUrlSchema(field: string) {
  return z
    .string({ error: `${field} must be a URL.` })
    .refine((value) => value.trim().length <= 2_048, {
      message: `${field} must be 2048 characters or fewer.`,
    })
    .refine(
      (value) => {
        const url = value.trim();
        if (!url) return true;
        try {
          return new URL(url).protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: `${field} must be a valid HTTPS URL.` },
    );
}
