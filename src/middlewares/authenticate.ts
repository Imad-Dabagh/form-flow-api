import type { RequestHandler } from "express";
import { AsyncHook } from "#app/services/index";
import { unauthenticated } from "#app/utils/errors";

const authenticate: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    return next(unauthenticated());
  }

  AsyncHook.updateRequestContext({ currentUserId: req.auth.userId });
  return next();
};

export default authenticate;
