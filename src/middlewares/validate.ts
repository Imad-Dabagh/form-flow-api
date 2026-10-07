import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { badRequest } from "#app/utils/errors";

type RequestSchemas = {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
};

/** Validate request shape before a route handler; handlers keep their existing normalization. */
export default function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
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
    }

    return next();
  };
}
