import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import { COLOR_FAMILIES } from "#app/modules/_shared/constants";
import FormSubmissionStatus from "#app/modules/form-submission-status/models/index";
import FormSubmission from "#app/modules/form-submission/models/index";
import Form from "#app/modules/form/models/index";
import { conflict, internalError, notFound } from "#app/utils/errors";

const router = Router({ mergeParams: true });

const params = z.object({
  formId: z.string().refine(mongoose.isValidObjectId, {
    message: "A valid form ID is required.",
  }),
  submissionStatusId: z.string().refine(mongoose.isValidObjectId, {
    message: "A valid submission status ID is required.",
  }),
});

/** GET /api/orgs/:organizationSlug/forms/:formId/submission-statuses/:submissionStatusId */
router.get(
  "/",
  authorize("form.read"),
  validate({ params }),

  async (req, res, next) => {
    try {
      const organizationId = req.organizationAccess!.organizationId;
      const formId = req.params.formId;
      const form = await Form.exists({
        _id: formId,
        organizationId,
        archivedAt: null,
      });

      if (!form) throw notFound("Form");
      const status = await FormSubmissionStatus.findOne({
        organizationId,
        formId,
        _id: req.params.submissionStatusId,
      }).lean();

      if (!status) throw notFound("Submission status");
      const submissionCount = await FormSubmission.countDocuments({
        organizationId,
        formId,
        submissionStatusId: status._id,
      });

      return res.status(200).json({
        success: true,
        data: {
          id: String(status._id),
          name: status.name,
          description: status.description ?? "",
          color: status.color,
          order: status.order,
          isDefault: status.isDefault ?? false,
          isSubmissionLocked: status.isSubmissionLocked ?? false,
          submissionCount,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

/** PUT /api/orgs/:organizationSlug/forms/:formId/submission-statuses/:submissionStatusId */
router.put(
  "/",
  authorize("form.update"),
  validate({
    params,
    body: z
      .strictObject({
        name: z.string().trim().min(1).max(50).optional(),
        description: z.string().trim().max(500).optional(),
        color: z.enum(COLOR_FAMILIES).optional(),
        isDefault: z.boolean().optional(),
        isSubmissionLocked: z.boolean().optional(),
      })
      .refine((body) => Object.keys(body).length > 0, {
        message: "At least one field is required.",
      }),
  }),

  async (req, res, next) => {
    const session = await mongoose.startSession();

    try {
      const organizationId = req.organizationAccess!.organizationId;
      const formId = req.params.formId;
      const status = await session.withTransaction(async () => {
        const form = await Form.updateOne(
          { _id: formId, organizationId, archivedAt: null },
          { $inc: { statusRevision: 1 } },
          { session },
        );

        if (form.matchedCount !== 1) throw notFound("Form");
        const target = await FormSubmissionStatus.findOne({
          organizationId,
          formId,
          _id: req.params.submissionStatusId,
        }).session(session);

        if (!target) throw notFound("Submission status");

        if (req.body.isDefault === false && target.isDefault) {
          throw conflict(
            "Choose another default submission status before clearing this one.",
          );
        }

        if (req.body.isDefault) {
          await FormSubmissionStatus.updateMany(
            { organizationId, formId, _id: { $ne: target._id } },
            { $set: { isDefault: false } },
            { session },
          );
        }

        if (req.body.name !== undefined) target.name = req.body.name;

        if (req.body.description !== undefined)
          target.description = req.body.description;

        if (req.body.color !== undefined) target.color = req.body.color;

        if (req.body.isSubmissionLocked !== undefined) {
          target.isSubmissionLocked = req.body.isSubmissionLocked;
        }

        if (req.body.isDefault !== undefined)
          target.isDefault = req.body.isDefault;

        await target.save({ session });

        return target;
      });

      if (!status) throw internalError();

      return res.status(200).json({
        success: true,
        data: {
          id: String(status._id),
          name: status.name,
          description: status.description ?? "",
          color: status.color,
          order: status.order,
          isDefault: status.isDefault ?? false,
          isSubmissionLocked: status.isSubmissionLocked ?? false,
        },
      });
    } catch (error) {
      return next(error);
    } finally {
      await session.endSession();
    }
  },
);

/** DELETE /api/orgs/:organizationSlug/forms/:formId/submission-statuses/:submissionStatusId */
router.delete(
  "/",
  authorize("form.update"),
  validate({ params }),
  async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
      const organizationId = req.organizationAccess!.organizationId;
      const formId = req.params.formId;
      await session.withTransaction(async () => {
        const form = await Form.updateOne(
          { _id: formId, organizationId, archivedAt: null },
          { $inc: { statusRevision: 1 } },
          { session },
        );
        if (form.matchedCount !== 1) throw notFound("Form");
        const status = await FormSubmissionStatus.findOne({
          organizationId,
          formId,
          _id: req.params.submissionStatusId,
        })
          .session(session)
          .lean();
        if (!status) throw notFound("Submission status");

        if (status.isDefault) {
          throw conflict(
            "Choose another default submission status before deleting this one.",
          );
        }

        const submissionCount = await FormSubmission.countDocuments({
          organizationId,
          formId,
          submissionStatusId: status._id,
        }).session(session);

        if (submissionCount > 0) {
          throw conflict("A submission status in use cannot be deleted.");
        }

        await FormSubmissionStatus.deleteOne(
          { organizationId, formId, _id: status._id },
          { session },
        );

        await FormSubmissionStatus.updateMany(
          { organizationId, formId, order: { $gt: status.order } },
          { $inc: { order: -1 } },
          { session },
        );
      });
      return res.status(200).json({
        success: true,
        data: { id: req.params.submissionStatusId },
      });
    } catch (error) {
      return next(error);
    } finally {
      await session.endSession();
    }
  },
);

export default router;
