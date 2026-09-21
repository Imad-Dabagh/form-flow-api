import type { RequestHandler } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import config from "../config";
import type { AuthenticatedRequestUser } from "../types/global";
import { unauthenticated } from "../utils/errors";

function getBearerToken(authorization?: string): string | undefined {
  const [scheme, token, ...extra] = authorization?.trim().split(/\s+/) ?? [];

  if (scheme !== "Bearer" || !token || extra.length > 0) {
    return undefined;
  }

  return token;
}

function getAuthenticatedUser(payload: string | JwtPayload): AuthenticatedRequestUser | undefined {
  if (typeof payload === "string" || typeof payload.sub !== "string" || !payload.sub) {
    return undefined;
  }

  return { userId: payload.sub };
}

const attachJwt: RequestHandler = (req, _res, next) => {
  const authorization = req.header("authorization");

  // Public routes continue without an authenticated user.
  if (!authorization) {
    return next();
  }

  const token = getBearerToken(authorization);
  if (!token) {
    return next(unauthenticated());
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    const authenticatedUser = getAuthenticatedUser(payload);

    if (!authenticatedUser) {
      return next(unauthenticated());
    }

    req.auth = authenticatedUser;
    return next();
  } catch {
    return next(unauthenticated());
  }
};

export default attachJwt;
