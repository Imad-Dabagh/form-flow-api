import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import { z } from "zod";
import { validate } from "#app/middlewares/index";
import { tooManyRequests } from "#app/utils/errors";

const router = Router({ mergeParams: true });
const formIdSchema = z.string().refine(mongoose.isValidObjectId, "A valid form ID is required.");

router.use(rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 120,
  keyGenerator: (req) => req.auth!.userId,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(tooManyRequests("Submission request limit reached. Try again later.")),
}));
router.use(validate({ params: z.object({ formId: formIdSchema }) }));
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

export default router;
