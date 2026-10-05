import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import { COLOR_FAMILIES } from "#app/modules/_shared/constants";
import FormSubmissionStatus from "#app/modules/form-submission-status/models/index";
import FormSubmission from "#app/modules/form-submission/models/index";
import Form from "#app/modules/form/models/index";
import { internalError, notFound } from "#app/utils/errors";

const router = Router({ mergeParams: true });
const params = z.object({
  formId: z.string().refine(mongoose.isValidObjectId, {
    message: "A valid form ID is required.",
  }),
});

/** GET /api/orgs/:organizationSlug/forms/:formId/submission-statuses */
router.get<{ formId: string }>(
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

      const [statuses, counts] = await Promise.all([
        FormSubmissionStatus.find({ organizationId, formId })
          .sort({ order: 1, _id: 1 })
          .lean(),
        FormSubmission.aggregate<{
          _id: mongoose.Types.ObjectId;
          count: number;
        }>([
          {
            $match: {
              organizationId: new mongoose.Types.ObjectId(organizationId),
              formId: new mongoose.Types.ObjectId(formId),
              submissionStatusId: { $ne: null },
            },
          },
          { $group: { _id: "$submissionStatusId", count: { $sum: 1 } } },
        ]),
      ]);

      const countsById = new Map(
        counts.map(({ _id, count }) => [String(_id), count]),
      );

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
          submissionCount: countsById.get(String(status._id)) ?? 0,
        })),
      });

    } catch (error) {
      return next(error);
    }
  },
);

/** POST /api/orgs/:organizationSlug/forms/:formId/submission-statuses */
router.post<{ formId: string }>(
  "/",
  authorize("form.update"),
  validate({
    params,
    body: z.strictObject({
      name: z.string().trim().min(1).max(50),
      description: z.string().trim().max(500).optional(),
      color: z.enum(COLOR_FAMILIES),
      isDefault: z.boolean().optional(),
      isSubmissionLocked: z.boolean().optional(),
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
        const lastStatus = await FormSubmissionStatus.findOne({
          organizationId,
          formId,
        })
          .sort({ order: -1 })
          .select("order")
          .session(session)
          .lean();
        if (req.body.isDefault) {
          await FormSubmissionStatus.updateMany(
            { organizationId, formId },
            { $set: { isDefault: false } },
            { session },
          );
        }
        const [created] = await FormSubmissionStatus.create(
          [
            {
              organizationId,
              formId,
              name: req.body.name,
              description: req.body.description,
              color: req.body.color,
              order: (lastStatus?.order ?? 0) + 1,
              isDefault: req.body.isDefault,
              isSubmissionLocked: req.body.isSubmissionLocked,
            },
          ],
          { session },
        );
        return created;
      });
      if (!status) throw internalError();
      return res.status(201).json({
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

export default router;
