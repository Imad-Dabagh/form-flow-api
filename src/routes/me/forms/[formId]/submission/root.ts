import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { ORGANIZATION_ROLES } from "#app/modules/_shared/constants";
import FormModule from "#app/modules/form/index";
import { toSubmissionFormPresentation } from "#app/modules/form/submission-form-presentation";
import FormSubmissionStatusModule from "#app/modules/form-submission-status/index";
import FormSubmissionModule from "#app/modules/form-submission/index";
import MembershipModule from "#app/modules/membership/index";
import UserModule from "#app/modules/user/index";
import { badRequest, conflict, notFound } from "#app/utils/errors";
import {
  assertEditable,
  findForm,
  findSubmission,
  formClosed,
  submissionData,
  validateSavedAnswers,
  visibleQuestions,
  type Submission,
} from "#app/modules/form-submission/services/current-user-submission";

const router = Router({ mergeParams: true });

const saveSchema = z.strictObject({
  formAnswers: z.record(
    z.string(),
    z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string()), z.null()]),
  ),
});
/** GET /api/me/forms/:formId/submission — open or resume. */
router.get<{ formId: string }>("/", async (req, res, next) => {
  try {
    const form = await findForm(req.params.formId);
    const userId = req.auth!.userId;
    const user = (await UserModule.services.fetchById({
      id: userId,
      selection: "firstName lastName email phone",
    })) as Parameters<typeof generateKeywords>[0] | null;
    if (!user) throw notFound("User");
    const searchKeywords = generateKeywords(user);
    let submission = (await FormSubmissionModule.services.fetchOne({
      query: { formId: form._id, submittedBy: userId },
    })) as Submission | null;

    if (!submission) {
      if (form.isClosed) throw formClosed();
      const session = await mongoose.startSession();
      try {
        submission =
          (await session.withTransaction(async () => {
            const formLock = await FormModule.services.updateOne({
              query: { _id: form._id, archivedAt: null, isClosed: false },
              payload: { $inc: { statusRevision: 1 } },
              session,
            });
            if (!formLock) throw formClosed();

            const defaultStatus = (await FormSubmissionStatusModule.services.fetchOne({
              query: {
                organizationId: form.organizationId,
                formId: form._id,
                isDefault: true,
              },
              selection: "_id",
              session,
            })) as { _id: mongoose.Types.ObjectId } | null;
            if (!defaultStatus) throw conflict("This form has no default submission status.");

            return (await FormSubmissionModule.services.updateOne({
              query: { formId: form._id, submittedBy: userId },
              payload: {
                $setOnInsert: {
                  organizationId: form.organizationId,
                  submissionStatusId: defaultStatus._id,
                  answers: {},
                  submittedAt: null,
                  searchKeywords,
                },
              },
              upsert: true,
              session,
            })) as Submission | null;
          })) ?? null;
      } finally {
        await session.endSession();
      }
    }
    if (!submission) throw notFound("Submission");
    if (submission.searchKeywords !== searchKeywords) {
      await FormSubmissionModule.services.updateById({
        id: String(submission._id),
        payload: { $set: { searchKeywords } },
      });
    }

    await MembershipModule.services.updateOne({
      query: { userId, organizationId: form.organizationId },
      payload: { $setOnInsert: { role: ORGANIZATION_ROLES.USER } },
      upsert: true,
    });

    const statuses = (await FormSubmissionStatusModule.services.findMany({
      query: { organizationId: form.organizationId, formId: form._id },
      sort: { order: 1, _id: 1 },
    })) as Array<{
      _id: mongoose.Types.ObjectId;
      name: string;
      description?: string;
      color: string;
      order: number;
      isDefault?: boolean;
      isSubmissionLocked?: boolean;
    }>;

    return res.status(200).json({
      success: true,
      data: {
        form: toSubmissionFormPresentation(form),
        submission: submissionData(submission),
        submissionStatuses: statuses.map((status) => ({
          id: String(status._id),
          name: status.name,
          description: status.description ?? "",
          color: status.color,
          order: status.order,
          isDefault: status.isDefault ?? false,
          isSubmissionLocked: status.isSubmissionLocked ?? false,
        })),
      },
    });
  } catch (error) {
    return next(error);
  }
});

/** PUT /api/me/forms/:formId/submission — save answers before or after submission. */
router.put<{ formId: string }>("/", async (req, res, next) => {
  try {
    const input = saveSchema.safeParse(req.body);
    if (!input.success) throw badRequest("Send a formAnswers object.");

    const form = await findForm(req.params.formId);
    const submission = await findSubmission(form, req.auth!.userId);
    await assertEditable(form, submission);

    const questions = visibleQuestions(form);
    const editableIds = new Set(
      questions.filter((question) => question.inputType !== "file").map((question) => question._id),
    );
    const fileIds = new Set(
      questions.filter((question) => question.inputType === "file").map((question) => question._id),
    );
    if (Object.keys(input.data.formAnswers).some((id) => !editableIds.has(id))) {
      throw badRequest("An answer does not belong to a visible non-file question.");
    }

    const files = Object.fromEntries(
      Object.entries(submission.answers).filter(([id]) => fileIds.has(id)),
    );
    const answers = { ...input.data.formAnswers, ...files };
    const updated = (await FormSubmissionModule.services.updateOne({
      query: {
        _id: submission._id,
        submissionStatusId: submission.submissionStatusId,
        submittedAt: submission.submittedAt,
      },
      payload: {
        $set: { answers: submission.submittedAt ? validateSavedAnswers(form, answers) : answers },
      },
    })) as Submission | null;
    if (!updated) throw conflict("This submission changed while saving. Reload it and try again.");

    return res.status(200).json({ success: true, data: submissionData(updated) });
  } catch (error) {
    return next(error);
  }
});

export default router;

function generateKeywords(user: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  return [user.firstName, user.lastName, user.email, user.phone]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .join(" ")
    .substring(0, 99);
}
