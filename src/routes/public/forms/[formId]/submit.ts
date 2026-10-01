import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import { z } from "zod";
import { validate } from "#app/middlewares/index";
import FormSubmission from "#app/modules/form-submission/models/index";
import { validateFormAnswers } from "#app/modules/form-submission/validate-form-answers";
import Form from "#app/modules/form/models/index";
import { conflict, notFound, tooManyRequests } from "#app/utils/errors";

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
    body: z.strictObject({
      formAnswers: z.record(z.string(), z.unknown()),
    }),
  }),
  async (req, res, next) => {
    try {
      const form = await Form.findOne({
        _id: req.params.formId,
        type: "PUBLIC",
        archivedAt: null,
      }).select("organizationId name sections isClosed").lean();
      if (!form) throw notFound("Form");
      if (form.isClosed) throw conflict("This form is closed.");

      const answers = validateFormAnswers(form.sections, req.body.formAnswers);
      const submission = await FormSubmission.create({
        organizationId: form.organizationId,
        formId: form._id,
        formName: form.name,
        answers,
      });

      return res.status(201).json({
        success: true,
        data: {
          id: String(submission._id),
          submittedAt: submission.createdAt,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
