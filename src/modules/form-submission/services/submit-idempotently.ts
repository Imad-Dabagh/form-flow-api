import type { Request } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import FormSubmissionStatus from "#app/modules/form-submission-status/models/index";
import Form from "#app/modules/form/models/index";
import { AppError, badRequest, conflict, internalError } from "#app/utils/errors";
import FormSubmission from "../models/index.js";
import { receiveSubmission } from "./receive-submission.js";
import type { SubmissionSection } from "./validate-form-answers.js";

interface SubmissionForm {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  sections: SubmissionSection[];
  isClosed?: boolean;
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export async function submitIdempotently(req: Request, form: SubmissionForm) {
  const idempotencyKey = req.get("Idempotency-Key");
  if (!idempotencyKey || !z.uuid().safeParse(idempotencyKey).success) {
    throw badRequest("A valid Idempotency-Key header is required.");
  }

  const query = {
    formId: form._id,
    idempotencyKey,
  };
  const existing = await FormSubmission.findOne({ ...query, submittedAt: { $ne: null } })
    .select("_id submittedAt")
    .lean();
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
            const formLock = await Form.updateOne(
              { _id: form._id, type: "PUBLIC", archivedAt: null, isClosed: false },
              { $inc: { statusRevision: 1 } },
              { session },
            );
            if (formLock.matchedCount !== 1) {
              throw new AppError("This form is closed.", { statusCode: 409, code: "FORM_CLOSED" });
            }

            const defaultStatus = await FormSubmissionStatus.findOne({
              organizationId: form.organizationId,
              formId: form._id,
              isDefault: true,
            })
              .select("_id")
              .session(session)
              .lean();
            if (!defaultStatus) throw conflict("This form has no default submission status.");

            const [created] = await FormSubmission.create(
              [
                {
                  organizationId: form.organizationId,
                  formId: form._id,
                  submissionStatusId: defaultStatus._id,
                  submittedBy: null,
                  idempotencyKey,
                  submittedAt: new Date(),
                  answers,
                },
              ],
              { session },
            );
            return created;
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
      const submitted = await FormSubmission.findOne({ ...query, submittedAt: { $ne: null } })
        .select("_id submittedAt")
        .lean();
      if (submitted) return { submission: submitted, replayed: true };
    }
    throw error;
  }
}
