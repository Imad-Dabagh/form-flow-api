import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { badRequest } from "#app/utils/errors";

type RequestSchemas = {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
};

/** Validate configured segments and expose their parsed values through the existing request fields. */
export default function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    const parsed: Partial<Record<keyof RequestSchemas, unknown>> = {};

    for (const source of ["params", "body", "query"] as const) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (!result.success) {
        const issue =
          result.error.issues.find((item) => item.code === "unrecognized_keys") ??
          result.error.issues[0];
        const message =
          source === "body" && issue.path.length === 0 && issue.code === "invalid_type"
            ? "A JSON object is required."
            : issue.message;
        return next(badRequest(message));
      }

      parsed[source] = result.data;
    }

    // Commit only after every configured segment passes. Express 5's query is
    // a getter, so define an own property to retain its parsed value downstream.
    for (const source of Object.keys(parsed) as Array<keyof RequestSchemas>) {
      Object.defineProperty(req, source, {
        value: parsed[source],
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    return next();
  };
}
