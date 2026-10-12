import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import FormSubmissionStatusModule from "#app/modules/form-submission-status/index";
import FormModule from "#app/modules/form/index";
import { badRequest, internalError, notFound } from "#app/utils/errors";

const router = Router({ mergeParams: true });

/** PUT /api/orgs/:organizationSlug/forms/:formId/submission-statuses/reorder */
router.put<{ formId: string }>(
  "/",
  authorize("form.update"),
  validate({
    params: z.object({
      formId: z.string().refine(mongoose.isValidObjectId, {
        message: "A valid form ID is required.",
      }),
    }),
    body: z.strictObject({
      statusIds: z
        .array(
          z.string().refine(mongoose.isValidObjectId, {
            message: "A valid submission status ID is required.",
          }),
        )
        .min(1),
    }),
  }),
  async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
      const organizationId = req.organizationAccess!.organizationId;
      const formId = req.params.formId;
      const statuses = await session.withTransaction(async () => {
        const form = await FormModule.services.updateById({
          id: formId,
          query: { organizationId, archivedAt: null },
          payload: { $inc: { statusRevision: 1 } },
          session,
        });
        if (!form) throw notFound("Form");
        const existing = (await FormSubmissionStatusModule.services.findMany({
          query: { organizationId, formId },
          session,
        })) as Array<{
          _id: unknown;
          name: string;
          description?: string;
          color: string;
          order: number;
          isDefault?: boolean;
          isSubmissionLocked?: boolean;
        }>;
        const statusIds: string[] = req.body.statusIds;
        const existingById = new Map(existing.map((status) => [String(status._id), status]));
        if (
          statusIds.length !== existing.length ||
          new Set(statusIds).size !== statusIds.length ||
          statusIds.some((id) => !existingById.has(id))
        ) {
          throw badRequest(
            "statusIds must contain every submission status for this form exactly once.",
          );
        }
        await FormSubmissionStatusModule.services.bulkWrite({
          operations: statusIds.map((id, index) => ({
            updateOne: {
              filter: { organizationId, formId, _id: id },
              update: { $set: { order: index + 1 } },
            },
          })),
          session,
        });
        return statusIds.map((id, index) => ({ ...existingById.get(id)!, order: index + 1 }));
      });
      if (!statuses) throw internalError();
      return res.status(200).json({
        success: true,
        data: statuses.map((status) => ({
          id: String(status._id),
          name: status.name,
          description: status.description ?? "",
          color: status.color,
          order: status.order,
          isDefault: status.isDefault ?? false,
          isSubmissionLocked: status.isSubmissionLocked ?? false,
        })),
      });
    } catch (error) {
      return next(error);
    } finally {
      await session.endSession();
    }
  },
);

export default router;
