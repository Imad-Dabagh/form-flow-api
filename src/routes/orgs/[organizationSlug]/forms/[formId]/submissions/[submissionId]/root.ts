import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import FormSubmissionStatusModule from "#app/modules/form-submission-status/index";
import FormSubmissionModule from "#app/modules/form-submission/index";
import FormModule from "#app/modules/form/index";
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
        const form = await FormModule.services.updateById({
          id: formId,
          query: { organizationId, archivedAt: null },
          payload: { $inc: { statusRevision: 1 } },
          session,
        });
        if (!form) throw notFound("Form");

        const status = (await FormSubmissionStatusModule.services.fetchById({
          id: req.body.submissionStatusId,
          query: { organizationId, formId },
          selection: "_id",
          session,
        })) as { _id: unknown } | null;
        if (!status) throw notFound("Submission status");

        const updated = (await FormSubmissionModule.services.updateById({
          id: req.params.submissionId,
          query: { organizationId, formId },
          payload: { $set: { submissionStatusId: status._id } },
          selection: "_id submissionStatusId updatedAt",
          session,
        })) as { _id: unknown; submissionStatusId: unknown; updatedAt: Date } | null;
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
