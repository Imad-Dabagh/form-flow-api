import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import Form from "#app/modules/form/models/index";
import FormSubmission from "#app/modules/form-submission/models/index";
import FormSubmissionStatus from "#app/modules/form-submission-status/models/index";
import User from "#app/modules/user/models/index";

const router = Router({ mergeParams: true });
const DAY_MS = 86_400_000;

interface ActiveForm {
  _id: mongoose.Types.ObjectId;
  name: string;
  type: "PUBLIC" | "AUTHENTICATED";
  isClosed: boolean;
  createdAt: Date;
}

interface SubmissionTotals {
  _id: mongoose.Types.ObjectId;
  submissions: number;
  previousSubmissions: number;
  unfinished: number;
  lastSubmittedAt: Date | null;
}

interface RecentSubmission {
  _id: mongoose.Types.ObjectId;
  formId: mongoose.Types.ObjectId;
  submittedBy: mongoose.Types.ObjectId | null;
  submissionStatusId: mongoose.Types.ObjectId;
  submittedAt: Date;
}

/** GET /api/orgs/:organizationSlug/dashboard */
router.get(
  "/",
  authorize("submission.read"),
  validate({
    query: z
      .object({
        dateFrom: z.iso.datetime(),
        dateBefore: z.iso.datetime(),
        previousDateFrom: z.iso.datetime(),
        timeZone: z
          .string()
          .max(100)
          .refine((value) => {
            try {
              new Intl.DateTimeFormat("en", { timeZone: value });
              return true;
            } catch {
              return false;
            }
          }, "A valid time zone is required."),
      })
      .refine((value) => {
        const from = Date.parse(value.dateFrom);
        const before = Date.parse(value.dateBefore);
        const previous = Date.parse(value.previousDateFrom);
        return (
          previous < from &&
          from < before &&
          before - from <= 31 * DAY_MS &&
          from - previous <= 31 * DAY_MS
        );
      }, "Dashboard periods must be ordered and no longer than 31 days."),
  }),
  async (req, res, next) => {
    try {
      const organizationId = new mongoose.Types.ObjectId(req.organizationAccess!.organizationId);
      const from = new Date(String(req.query.dateFrom));
      const before = new Date(String(req.query.dateBefore));
      const previousFrom = new Date(String(req.query.previousDateFrom));
      const timeZone = String(req.query.timeZone);
      const forms = await Form.find({ organizationId, archivedAt: null })
        .select("name type isClosed createdAt")
        .lean<ActiveForm[]>();
      const formsById = new Map(forms.map((form) => [String(form._id), form]));

      const result = await readSubmissionActivity({
        organizationId,
        formIds: forms.map((form) => form._id),
        from,
        before,
        previousFrom,
        timeZone,
      });

      const totalsByForm = new Map(result.byForm.map((item) => [String(item._id), item]));
      const formSummaries = forms.map((form) => {
        const totals = totalsByForm.get(String(form._id));
        return {
          id: String(form._id),
          name: form.name,
          type: form.type,
          isClosed: form.isClosed,
          createdAt: form.createdAt,
          submissions: totals?.submissions ?? 0,
          previousSubmissions: totals?.previousSubmissions ?? 0,
          unfinished: form.type === "AUTHENTICATED" ? (totals?.unfinished ?? 0) : 0,
          lastSubmittedAt: totals?.lastSubmittedAt ?? null,
        };
      });
      const recent = result.recent;
      const [users, statuses] = await Promise.all([
        recent.length
          ? User.find({
              _id: { $in: recent.flatMap((item) => (item.submittedBy ? [item.submittedBy] : [])) },
            })
              .select("firstName lastName email profilePic")
              .lean()
          : [],
        recent.length
          ? FormSubmissionStatus.find({
              organizationId,
              _id: { $in: recent.map((item) => item.submissionStatusId) },
              formId: { $in: recent.map((item) => item.formId) },
            })
              .select("formId name color")
              .lean()
          : [],
      ]);
      const usersById = new Map(users.map((user) => [String(user._id), user]));
      const statusesById = new Map(statuses.map((status) => [String(status._id), status]));

      return res.status(200).json({
        success: true,
        data: {
          period: { from, before, previousFrom, timeZone },
          summary: {
            activeForms: forms.length,
            openForms: forms.filter((form) => !form.isClosed).length,
            submissions: formSummaries.reduce((total, form) => total + form.submissions, 0),
            previousSubmissions: formSummaries.reduce(
              (total, form) => total + form.previousSubmissions,
              0,
            ),
            unfinished: formSummaries.reduce((total, form) => total + form.unfinished, 0),
          },
          activity: result.activity.map((item) => ({ date: item._id, count: item.count })),
          forms: formSummaries
            .sort(
              (a, b) =>
                b.submissions - a.submissions ||
                (b.lastSubmittedAt?.getTime() ?? 0) - (a.lastSubmittedAt?.getTime() ?? 0) ||
                b.createdAt.getTime() - a.createdAt.getTime() ||
                a.id.localeCompare(b.id),
            )
            .slice(0, 5)
            .map((form) => ({
              id: form.id,
              name: form.name,
              type: form.type,
              isClosed: form.isClosed,
              submissions: form.submissions,
              unfinished: form.unfinished,
              lastSubmittedAt: form.lastSubmittedAt,
            })),
          recentSubmissions: recent.map((submission) => {
            const form = formsById.get(String(submission.formId))!;
            const user = submission.submittedBy
              ? usersById.get(String(submission.submittedBy))
              : null;
            const status = statusesById.get(String(submission.submissionStatusId));
            return {
              id: String(submission._id),
              formId: String(submission.formId),
              formName: form.name,
              submittedAt: submission.submittedAt,
              submittedBy: !submission.submittedBy
                ? { kind: "anonymous" }
                : user
                  ? {
                      kind: "user",
                      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
                      profilePic: user.profilePic || null,
                    }
                  : { kind: "former-user" },
              status:
                status && String(status.formId) === String(submission.formId)
                  ? { id: String(status._id), name: status.name, color: status.color }
                  : null,
            };
          }),
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;

/** Aggregate only metadata for active forms; never return answer maps. */
async function readSubmissionActivity({
  organizationId,
  formIds,
  from,
  before,
  previousFrom,
  timeZone,
}: {
  organizationId: mongoose.Types.ObjectId;
  formIds: mongoose.Types.ObjectId[];
  from: Date;
  before: Date;
  previousFrom: Date;
  timeZone: string;
}) {
  if (!formIds.length) return { byForm: [], activity: [], recent: [] };
  const [result] = await FormSubmission.aggregate<{
    byForm: SubmissionTotals[];
    activity: Array<{ _id: string; count: number }>;
    recent: RecentSubmission[];
  }>([
    { $match: { organizationId, formId: { $in: formIds } } },
    { $project: { formId: 1, submittedAt: 1, submittedBy: 1, submissionStatusId: 1 } },
    {
      $facet: {
        byForm: [
          {
            $group: {
              _id: "$formId",
              submissions: {
                $sum: {
                  $cond: [
                    {
                      $and: [{ $gte: ["$submittedAt", from] }, { $lt: ["$submittedAt", before] }],
                    },
                    1,
                    0,
                  ],
                },
              },
              previousSubmissions: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: ["$submittedAt", previousFrom] },
                        { $lt: ["$submittedAt", from] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              unfinished: { $sum: { $cond: [{ $eq: ["$submittedAt", null] }, 1, 0] } },
              lastSubmittedAt: { $max: "$submittedAt" },
            },
          },
        ],
        activity: [
          { $match: { submittedAt: { $gte: from, $lt: before } } },
          {
            $group: {
              _id: {
                $dateToString: {
                  date: "$submittedAt",
                  format: "%Y-%m-%d",
                  timezone: timeZone,
                },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
        recent: [
          { $match: { submittedAt: { $gte: from, $lt: before } } },
          { $sort: { submittedAt: -1, _id: -1 } },
          { $limit: 5 },
          {
            $project: { formId: 1, submittedBy: 1, submissionStatusId: 1, submittedAt: 1 },
          },
        ],
      },
    },
  ]);
  return result;
}
