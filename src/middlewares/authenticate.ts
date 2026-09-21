import type { RequestHandler } from "express";
import { AsyncHook } from "../services/index.js";
import { unauthenticated } from "../utils/errors.js";

const authenticate: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    return next(unauthenticated());
  }

  AsyncHook.updateRequestContext({ currentUserId: req.auth.userId });
  return next();
};

export default authenticate;
