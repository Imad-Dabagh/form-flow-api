import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import { authenticatedUploadRateLimit } from "#app/modules/file-upload/authenticated-rate-limit";
import Form from "#app/modules/form/models/index";
import { uploadQuestionFile } from "#app/modules/form/services/upload-question-file";
import { badRequest, notFound } from "#app/utils/errors";

const router = Router({ mergeParams: true });

/** POST /api/orgs/:organizationSlug/forms/:formId/questions/:questionId/uploads */
router.post(
  "/",
  authorize("form.update"),
  authenticatedUploadRateLimit,
  validate({
    params: z.object({
      formId: z.string().refine(mongoose.isValidObjectId),
      questionId: z.string().min(1).max(128),
    }),
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
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
