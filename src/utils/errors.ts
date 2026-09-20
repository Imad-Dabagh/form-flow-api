export interface AppErrorOptions {
  statusCode: number;
  code: string;
  details?: unknown;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational = true;

  constructor(message: string, { statusCode, code, details }: AppErrorOptions) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = "Invalid request.", details?: unknown) =>
  new AppError(message, { statusCode: 400, code: "BAD_REQUEST", details });

export const unauthenticated = () =>
  new AppError("Authentication is required.", {
    statusCode: 401,
    code: "UNAUTHENTICATED",
  });

export const unauthorized = () =>
  new AppError("You are not authorized to perform this action.", {
    statusCode: 403,
    code: "UNAUTHORIZED",
  });

export const notFound = (entity = "Resource") =>
  new AppError(`${entity} was not found.`, {
    statusCode: 404,
    code: "NOT_FOUND",
  });

export const conflict = (message = "The resource already exists.") =>
  new AppError(message, { statusCode: 409, code: "CONFLICT" });

export const internalError = () =>
  new AppError("Something went wrong.", {
    statusCode: 500,
    code: "INTERNAL_ERROR",
  });
