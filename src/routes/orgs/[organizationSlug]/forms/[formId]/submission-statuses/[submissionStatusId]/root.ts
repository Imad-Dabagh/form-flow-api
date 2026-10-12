import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import { COLOR_FAMILIES } from "#app/modules/_shared/constants";
import FormSubmissionStatusModule from "#app/modules/form-submission-status/index";
import FormSubmissionModule from "#app/modules/form-submission/index";
import FormModule from "#app/modules/form/index";
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

interface StatusRecord {
  _id: unknown;
  name: string;
  description?: string;
  color: string;
  order: number;
  isDefault?: boolean;
  isSubmissionLocked?: boolean;
}

/** GET /api/orgs/:organizationSlug/forms/:formId/submission-statuses/:submissionStatusId */
router.get<{ formId: string; submissionStatusId: string }>(
  "/",
  authorize("form.read"),
  validate({ params }),

  async (req, res, next) => {
    try {
      const organizationId = req.organizationAccess!.organizationId;
      const formId = req.params.formId;
      const form = await FormModule.services.existsById({
        id: formId,
        query: { organizationId, archivedAt: null },
      });

      if (!form) throw notFound("Form");
      const status = (await FormSubmissionStatusModule.services.fetchById({
        id: req.params.submissionStatusId,
        query: { organizationId, formId },
      })) as StatusRecord | null;

      if (!status) throw notFound("Submission status");
      const submissionCount = await FormSubmissionModule.services.countDocuments({
        query: { organizationId, formId, submissionStatusId: status._id },
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
router.put<{ formId: string; submissionStatusId: string }>(
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
        const form = await FormModule.services.updateById({
          id: formId,
          query: { organizationId, archivedAt: null },
          payload: { $inc: { statusRevision: 1 } },
          session,
        });

        if (!form) throw notFound("Form");
        const target = (await FormSubmissionStatusModule.services.fetchById({
          id: req.params.submissionStatusId,
          query: { organizationId, formId },
          session,
        })) as StatusRecord | null;

        if (!target) throw notFound("Submission status");

        if (req.body.isDefault === false && target.isDefault) {
          throw conflict("Choose another default submission status before clearing this one.");
        }

        if (req.body.isDefault) {
          await FormSubmissionStatusModule.services.updateMany({
            query: { organizationId, formId, _id: { $ne: target._id } },
            payload: { $set: { isDefault: false } },
            session,
          });
        }

        return (await FormSubmissionStatusModule.services.updateById({
          id: req.params.submissionStatusId,
          query: { organizationId, formId },
          payload: { $set: req.body },
          session,
        })) as StatusRecord | null;
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
router.delete<{ formId: string; submissionStatusId: string }>(
  "/",
  authorize("form.update"),
  validate({ params }),
  async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
      const organizationId = req.organizationAccess!.organizationId;
      const formId = req.params.formId;
      await session.withTransaction(async () => {
        const form = await FormModule.services.updateById({
          id: formId,
          query: { organizationId, archivedAt: null },
          payload: { $inc: { statusRevision: 1 } },
          session,
        });
        if (!form) throw notFound("Form");
        const status = (await FormSubmissionStatusModule.services.fetchById({
          id: req.params.submissionStatusId,
          query: { organizationId, formId },
          session,
        })) as StatusRecord | null;
        if (!status) throw notFound("Submission status");

        if (status.isDefault) {
          throw conflict("Choose another default submission status before deleting this one.");
        }

        const submissionCount = await FormSubmissionModule.services.countDocuments({
          query: { organizationId, formId, submissionStatusId: status._id },
          session,
        });

        if (submissionCount > 0) {
          throw conflict("A submission status in use cannot be deleted.");
        }

        await FormSubmissionStatusModule.services.deleteById({
          id: req.params.submissionStatusId,
          query: { organizationId, formId },
          session,
        });

        await FormSubmissionStatusModule.services.updateMany({
          query: { organizationId, formId, order: { $gt: status.order } },
          payload: { $inc: { order: -1 } },
          session,
        });
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
