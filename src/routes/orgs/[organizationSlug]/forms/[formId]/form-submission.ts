import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import { ORGANIZATION_ROLES } from "#app/modules/_shared/constants";
import { authenticatedUploadRateLimit } from "#app/modules/file-upload/authenticated-rate-limit";
import Form from "#app/modules/form/models/index";
import { toSubmissionFormPresentation } from "#app/modules/form/submission-form-presentation";
import {
  submitIdempotently, uploadQuestionFile,
} from "#app/modules/form-submission/services/index";
import Membership from "#app/modules/membership/models/index";
import { badRequest, notFound, tooManyRequests } from "#app/utils/errors";

const router = Router({ mergeParams: true });
const formIdSchema = z.string().refine(mongoose.isValidObjectId, "A valid form ID is required.");

const authenticatedSubmissionRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  identifier: "authenticated-form-submission",
  keyGenerator: (req) => req.auth!.userId,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(tooManyRequests("Submission limit reached. Try again later.")),
});
function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === 11000;
}

/** GET /api/orgs/:organizationSlug/forms/:formId/submission */
router.get(
  "/submission",
  validate({
    params: z.object({
      organizationSlug: z.string(),
      formId: formIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const form = await Form.findOne({
        _id: req.params.formId,
        organizationId: req.organizationAccess!.organizationId,
        type: { $in: ["AUTHENTICATED", null] },
        archivedAt: null,
      }).select("name type description sections displayMode isClosed").lean();
      if (!form) throw notFound("Form");

      res.set("Cache-Control", "no-store");
      return res.status(200).json({
        success: true,
        data: toSubmissionFormPresentation(form),
      });
    } catch (error) {
      return next(error);
    }
  },
);

/** Mounted before organizationAccess so a signed-in user can join the organization. */
export const submissionAccessRoutes = Router({ mergeParams: true });
submissionAccessRoutes.put(
  "/",
  validate({ params: z.object({ organizationSlug: z.string(), formId: formIdSchema }) }),
  async (req, res, next) => {
    try {
      const organizationId = req.organization!.organizationId;
      const form = await Form.findOne({
        _id: req.params.formId,
        organizationId,
        type: { $in: ["AUTHENTICATED", null] },
        archivedAt: null,
      }).select("_id").lean();
      if (!form) throw notFound("Form");

      const membershipQuery = { userId: req.auth!.userId, organizationId };
      try {
        await Membership.updateOne(
          membershipQuery,
          { $setOnInsert: { role: ORGANIZATION_ROLES.USER } },
          { upsert: true },
        );
      } catch (error) {
        if (!isDuplicateKey(error) || !await Membership.exists(membershipQuery)) throw error;
      }
      return res.status(200).json({ success: true, data: { granted: true } });
    } catch (error) { return next(error); }
  },
);

router.put(
  "/submissions/submit",
  authenticatedSubmissionRateLimit,
  validate({ params: z.object({ organizationSlug: z.string(), formId: formIdSchema }) }),
  async (req, res, next) => {
    try {
      const form = await Form.findOne({
        _id: req.params.formId,
        organizationId: req.organizationAccess!.organizationId,
        type: { $in: ["AUTHENTICATED", null] },
        archivedAt: null,
      }).select("organizationId name sections isClosed").lean();
      if (!form) throw notFound("Form");
      const { submission, replayed } = await submitIdempotently(req, form, req.auth!.userId);
      return res.status(replayed ? 200 : 201).json({
        success: true,
        data: { id: String(submission._id), submittedAt: submission.submittedAt },
      });
    } catch (error) { return next(error); }
  },
);

router.post(
  "/questions/:questionId/uploads",
  authorize("form.update"),
  authenticatedUploadRateLimit,
  validate({
    params: z.object({ formId: formIdSchema, questionId: z.string().min(1).max(128) }),
  }),
  async (req, res, next) => {
    try {
      const questionId = req.params.questionId;
      if (typeof questionId !== "string") throw badRequest("A valid question ID is required.");
      const form = await Form.findOne({
        _id: req.params.formId,
        organizationId: req.organizationAccess!.organizationId,
        archivedAt: null,
      }).select("organizationId isClosed sections").lean();
      if (!form) throw notFound("Form");
      const file = await uploadQuestionFile({ request: req, form, questionId });
      return res.status(201).json({ success: true, data: file });
    } catch (error) { return next(error); }
  },
);

export default router;
