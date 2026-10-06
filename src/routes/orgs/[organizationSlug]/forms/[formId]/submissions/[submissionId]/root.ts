import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import FormSubmissionStatus from "#app/modules/form-submission-status/models/index";
import FormSubmission from "#app/modules/form-submission/models/index";
import Form from "#app/modules/form/models/index";
import { internalError, notFound } from "#app/utils/errors";

const router = Router({ mergeParams: true });

/** PUT /api/orgs/:organizationSlug/forms/:formId/submissions/:submissionId/status */
router.put<{ formId: string; submissionId: string }>(
  "/status",
  authorize("submission.update"),
  validate({
    params: z.object({
      formId: z.string().refine(mongoose.isValidObjectId, {
        message: "A valid form ID is required.",
      }),
      submissionId: z.string().refine(mongoose.isValidObjectId, {
        message: "A valid submission ID is required.",
      }),
    }),
    body: z.strictObject({
      submissionStatusId: z.string().refine(mongoose.isValidObjectId, {
        message: "A valid submission status ID is required.",
      }),
    }),
  }),
  async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
      const organizationId = req.organizationAccess!.organizationId;
      const formId = req.params.formId;
      const submission = await session.withTransaction(async () => {
        const form = await Form.updateOne(
          { _id: formId, organizationId, archivedAt: null },
          { $inc: { statusRevision: 1 } },
          { session },
        );
        if (form.matchedCount !== 1) throw notFound("Form");

        const status = await FormSubmissionStatus.findOne({
          _id: req.body.submissionStatusId,
          organizationId,
          formId,
        }).select("_id").session(session).lean();
        if (!status) throw notFound("Submission status");

        const updated = await FormSubmission.findOneAndUpdate(
          { _id: req.params.submissionId, organizationId, formId },
          { $set: { submissionStatusId: status._id } },
          { returnDocument: "after", runValidators: true, session },
        ).select("_id submissionStatusId updatedAt").lean();
        if (!updated) throw notFound("Submission");
        return updated;
      });
      if (!submission) throw internalError();

      return res.status(200).json({
        success: true,
        data: {
          id: String(submission._id),
          submissionStatusId: String(submission.submissionStatusId),
          updatedAt: submission.updatedAt,
        },
      });
    } catch (error) {
      return next(error);
    } finally {
      await session.endSession();
    }
  },
);

export default router;
