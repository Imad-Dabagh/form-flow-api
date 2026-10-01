import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import { z } from "zod";
import { validate } from "#app/middlewares/index";
import FormSubmission from "#app/modules/form-submission/models/index";
import { receiveSubmission } from "#app/modules/form-submission/receive-submission";
import Form from "#app/modules/form/models/index";
import { conflict, notFound, tooManyRequests } from "#app/utils/errors";

const router = Router({ mergeParams: true });

const authenticatedSubmissionRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  identifier: "authenticated-form-submission",
  keyGenerator: (req) => req.auth!.userId,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(tooManyRequests("Submission limit reached. Try again later.")),
});

/** PUT /api/orgs/:organizationSlug/forms/:formId/submissions/submit */
router.put(
  "/",
  authenticatedSubmissionRateLimit,
  validate({
    params: z.object({
      organizationSlug: z.string(),
      formId: z.string().refine(mongoose.isValidObjectId, "A valid form ID is required."),
    }),
  }),
  async (req, res, next) => {
    try {
      const form = await Form.findOne({
        _id: req.params.formId,
        organizationId: req.organizationAccess!.organizationId,
        type: { $in: ["AUTHENTICATED", null] },
        archivedAt: null,
      }).select("organizationId name sections isClosed").lean();
      if (!form) throw notFound("Form");
      if (form.isClosed) throw conflict("This form is closed.");

      const submission = await receiveSubmission(req, form.sections, String(form.organizationId),
        (answers) => FormSubmission.create({
          organizationId: form.organizationId,
          formId: form._id,
          formName: form.name,
          submittedBy: req.auth!.userId,
          answers,
        }));

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
