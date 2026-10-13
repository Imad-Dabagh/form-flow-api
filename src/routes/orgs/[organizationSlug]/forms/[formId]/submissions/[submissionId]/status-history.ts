import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import FormSubmissionStatusHistoryModule from "#app/modules/form-submission-status-history/index";
import FormSubmissionStatusModule from "#app/modules/form-submission-status/index";
import FormSubmissionModule from "#app/modules/form-submission/index";
import UserModule from "#app/modules/user/index";
import { notFound } from "#app/utils/errors";

const router = Router({ mergeParams: true });

interface HistoryRecord {
  _id: mongoose.Types.ObjectId;
  fromStatusId: mongoose.Types.ObjectId;
  toStatusId: mongoose.Types.ObjectId;
  changedBy: mongoose.Types.ObjectId;
  createdAt: Date;
}

interface StatusRecord {
  _id: mongoose.Types.ObjectId;
  name: string;
}

interface UserRecord {
  _id: mongoose.Types.ObjectId;
  firstName?: string;
  lastName?: string;
  email: string;
}

/** GET /api/orgs/:organizationSlug/forms/:formId/submissions/:submissionId/status-history */
router.get<{ formId: string; submissionId: string }>(
  "/",
  authorize("submission.read"),
  validate({
    params: z.object({
      formId: z.string().refine(mongoose.isValidObjectId, {
        message: "A valid form ID is required.",
      }),
      submissionId: z.string().refine(mongoose.isValidObjectId, {
        message: "A valid submission ID is required.",
      }),
    }),
  }),
  async (req, res, next) => {
    try {
      const organizationId = req.organizationAccess!.organizationId;
      const formId = req.params.formId;
      const submissionId = req.params.submissionId;
      const submissionExists = await FormSubmissionModule.services.existsById({
        id: submissionId,
        query: { organizationId, formId },
      });
      if (!submissionExists) throw notFound("Submission");

      const history = (await FormSubmissionStatusHistoryModule.services.findMany({
        query: { organizationId, formId, submissionId },
        sort: { createdAt: 1, _id: 1 },
      })) as HistoryRecord[];

      const statusIds = [
        ...new Set(history.flatMap((item) => [String(item.fromStatusId), String(item.toStatusId)])),
      ];
      const userIds = [...new Set(history.map((item) => String(item.changedBy)))];
      const [statuses, users] = await Promise.all([
        statusIds.length
          ? FormSubmissionStatusModule.services.findMany({
              query: { organizationId, formId, _id: { $in: statusIds } },
              selection: "_id name",
            })
          : [],
        userIds.length
          ? UserModule.services.findMany({
              query: { _id: { $in: userIds } },
              selection: "_id firstName lastName email",
            })
          : [],
      ]);

      const statusesById = new Map(
        (statuses as StatusRecord[]).map((status) => [String(status._id), status.name]),
      );

      const usersById = new Map(
        (users as UserRecord[]).map((user) => [
          String(user._id),
          [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
        ]),
      );

      return res.status(200).json({
        success: true,
        data: history.map((item) => ({
          id: String(item._id),
          fromStatus: {
            id: String(item.fromStatusId),
            name: statusesById.get(String(item.fromStatusId)) ?? null,
          },
          toStatus: {
            id: String(item.toStatusId),
            name: statusesById.get(String(item.toStatusId)) ?? null,
          },
          changedBy: {
            id: String(item.changedBy),
            name: usersById.get(String(item.changedBy)) ?? null,
          },
          createdAt: item.createdAt,
        })),
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
