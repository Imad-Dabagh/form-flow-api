import { rateLimit } from "express-rate-limit";
import { tooManyRequests } from "#app/utils/errors";

export const authenticatedUploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  identifier: "file-upload",
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.auth!.userId,
  handler: (_req, _res, next) => next(tooManyRequests("Upload limit reached. Try again later.")),
});
