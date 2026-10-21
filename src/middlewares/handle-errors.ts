import type { ErrorRequestHandler } from "express";
import { AsyncHook, Logger } from "#app/services/index";
import {
  AppError,
  badRequest,
  conflict,
  internalError,
  payloadTooLarge,
  unsupportedMediaType,
} from "#app/utils/errors";

type MongoLikeError = Error & {
  code?: number;
  keyValue?: Record<string, unknown>;
  path?: string;
  errors?: Record<string, { message?: string }>;
  body?: unknown;
  type?: string;
};

function normalizeError(error: MongoLikeError): AppError {
  if (error instanceof AppError) {
    return Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
      ? error
      : internalError();
  }

  // Map known parser failures without exposing request bodies or trusting an
  // arbitrary error's status/message as a public HTTP response.
  switch (error.type) {
    case "entity.too.large":
      return payloadTooLarge();
    case "parameters.too.many":
      return payloadTooLarge("The request contains too many parameters.");
    case "encoding.unsupported":
    case "charset.unsupported":
      return unsupportedMediaType("The request body encoding is not supported.");
    case "entity.parse.failed":
      return badRequest(
        error instanceof SyntaxError ? "Malformed JSON request body." : "Malformed request body.",
      );
    case "querystring.parse.rangeError":
      return badRequest("The request body exceeds the supported nesting depth.");
    case "request.aborted":
      return badRequest("The request was aborted.");
    case "request.size.invalid":
      return badRequest("The request body size does not match Content-Length.");
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

const handleErrors: ErrorRequestHandler = (error: MongoLikeError, _req, res, next) => {
  const normalized = normalizeError(error);
  const requestId = AsyncHook.getRequestContext()?.requestId;

  Logger.error("Request failed", {
    requestId,
    statusCode: normalized.statusCode,
    code: normalized.code,
    errorName: error.name,
    errorMessage: error.message,
  });

  if (res.headersSent) {
    return next(error);
  }

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
