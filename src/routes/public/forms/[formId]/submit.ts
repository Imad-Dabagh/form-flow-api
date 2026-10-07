import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import { z } from "zod";
import { validate } from "#app/middlewares/index";
import { submitIdempotently } from "#app/modules/form-submission/services/index";
import Form from "#app/modules/form/models/index";
import { notFound, tooManyRequests } from "#app/utils/errors";

const router = Router({ mergeParams: true });

const publicSubmissionRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  identifier: "public-form-submission",
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(tooManyRequests("Submission limit reached. Try again later.")),
});

/** PUT /api/public/forms/:formId/submissions/submit */
router.put(
  "/",
  publicSubmissionRateLimit,
  validate({
    params: z.object({
      formId: z.string().refine(mongoose.isValidObjectId, "A valid form ID is required."),
    }),
  }),
  async (req, res, next) => {
    try {
      const form = await Form.findOne({
        _id: req.params.formId,
        type: "PUBLIC",
        archivedAt: null,
      })
        .select("organizationId sections isClosed")
        .lean();
      if (!form) throw notFound("Form");
      const { submission, replayed } = await submitIdempotently(req, form);

      return res.status(replayed ? 200 : 201).json({
        success: true,
        data: {
          id: String(submission._id),
          submittedAt: submission.submittedAt,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
