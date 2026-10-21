import type { Request } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import FormSubmissionStatusModule from "#app/modules/form-submission-status/index";
import FormModule from "#app/modules/form/index";
import { assertActiveOrganization } from "#app/modules/organization/services/index";
import { AppError, badRequest, conflict, internalError } from "#app/utils/errors";
import FormSubmissionServices from "./default.js";
import { receiveSubmission } from "./receive-submission.js";
import type { SubmissionSection } from "./validate-form-answers.js";

interface SubmissionForm {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  sections: SubmissionSection[];
  isClosed?: boolean;
}

interface SubmissionReceipt {
  _id: mongoose.Types.ObjectId;
  submittedAt: Date;
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export async function submitIdempotently(req: Request, form: SubmissionForm) {
  const idempotencyKey = req.get("Idempotency-Key");
  if (!idempotencyKey || !z.uuid().safeParse(idempotencyKey).success) {
    throw badRequest("A valid Idempotency-Key header is required.");
  }

  await assertActiveOrganization(String(form.organizationId));

  const query = {
    formId: form._id,
    idempotencyKey,
    submittedAt: { $ne: null },
  };
  const existing = (await FormSubmissionServices.fetchOne({
    query,
    selection: "_id submittedAt",
  })) as SubmissionReceipt | null;
  if (existing) return { submission: existing, replayed: true };
  if (form.isClosed) {
    throw new AppError("This form is closed.", { statusCode: 409, code: "FORM_CLOSED" });
  }

  try {
    const submission = await receiveSubmission(
      req,
      form.sections,
      String(form.organizationId),
      async (answers) => {
        const session = await mongoose.startSession();
        try {
          const submission = await session.withTransaction(async () => {
            const formLock = await FormModule.services.updateOne({
              query: { _id: form._id, type: "PUBLIC", archivedAt: null, isClosed: false },
              payload: { $inc: { statusRevision: 1 } },
              session,
            });
            if (!formLock) {
              throw new AppError("This form is closed.", { statusCode: 409, code: "FORM_CLOSED" });
            }

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

            return (await FormSubmissionServices.createOne({
              payload: {
                organizationId: form.organizationId,
                formId: form._id,
                submissionStatusId: defaultStatus._id,
                submittedBy: null,
                idempotencyKey,
                submittedAt: new Date(),
                answers,
              },
              session,
            })) as SubmissionReceipt;
          });
          if (!submission) throw internalError();
          return submission;
        } finally {
          await session.endSession();
        }
      },
    );
    return { submission, replayed: false };
  } catch (error) {
    if (isDuplicateKey(error)) {
      const submitted = (await FormSubmissionServices.fetchOne({
        query,
        selection: "_id submittedAt",
      })) as SubmissionReceipt | null;
      if (submitted) return { submission: submitted, replayed: true };
    }
    throw error;
  }
}
