import type { ErrorRequestHandler } from "express";
import { AsyncHook, Logger } from "../services/index.js";
import { AppError, badRequest, conflict, internalError } from "../utils/errors.js";

type MongoLikeError = Error & {
  code?: number;
  keyValue?: Record<string, unknown>;
  path?: string;
  errors?: Record<string, { message?: string }>;
  body?: unknown;
};

function normalizeError(error: MongoLikeError): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error.code === 11000) {
    const field = Object.keys(error.keyValue ?? {})[0] ?? "field";
    return conflict(`A resource with this ${field} already exists.`);
  }

  if (error.name === "ValidationError") {
    const details = Object.values(error.errors ?? {}).map((item) => item.message);
    return badRequest("Validation failed.", details);
  }

  if (error.name === "CastError") {
    return badRequest(`Invalid value for ${error.path ?? "identifier"}.`);
  }

  if (error instanceof SyntaxError && "body" in error) {
    return badRequest("Malformed JSON request body.");
  }

  return internalError();
}

const handleErrors: ErrorRequestHandler = (error: MongoLikeError, _req, res, _next) => {
  const normalized = normalizeError(error);
  const requestId = AsyncHook.getRequestContext()?.requestId;

  Logger.error("Request failed", {
    requestId,
    statusCode: normalized.statusCode,
    code: normalized.code,
    errorName: error.name,
    errorMessage: error.message,
  });

  res.status(normalized.statusCode).json({
    success: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details === undefined ? {} : { details: normalized.details }),
    },
    ...(requestId ? { requestId } : {}),
  });
};

export default handleErrors;
