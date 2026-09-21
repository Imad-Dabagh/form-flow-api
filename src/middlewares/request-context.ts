import type { RequestHandler } from "express";
import { AsyncHook } from "../services/index.js";

const requestContext: RequestHandler = (req, res, next) => {
  AsyncHook.runWithRequestContext(
    {
      method: req.method,
      path: req.originalUrl,
    },
    () => {
      const context = AsyncHook.getRequestContext();

      if (context) {
        res.setHeader("X-Request-Id", context.requestId);
      }

      next();
    },
  );
};

export default requestContext;
