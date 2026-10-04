import type { Request } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AppError, badRequest } from "#app/utils/errors";
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
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === 11000;
}

export async function submitIdempotently(
  req: Request,
  form: SubmissionForm,
) {
  const idempotencyKey = req.get("Idempotency-Key");
  if (!idempotencyKey || !z.uuid().safeParse(idempotencyKey).success) {
    throw badRequest("A valid Idempotency-Key header is required.");
  }

  const query = {
    formId: form._id,
    idempotencyKey,
  };
  const existing = await FormSubmission.findOne({ ...query, submittedAt: { $ne: null } })
    .select("_id submittedAt").lean();
  if (existing) return { submission: existing, replayed: true };
  if (form.isClosed) {
    throw new AppError("This form is closed.", { statusCode: 409, code: "FORM_CLOSED" });
  }

  try {
    const submission = await receiveSubmission(
      req,
      form.sections,
      String(form.organizationId),
      (answers) => FormSubmission.create({
        organizationId: form.organizationId,
        formId: form._id,
        submittedBy: null,
        idempotencyKey,
        submittedAt: new Date(),
        answers,
      }),
    );
    return { submission, replayed: false };
  } catch (error) {
    if (isDuplicateKey(error)) {
      const submitted = await FormSubmission.findOne({ ...query, submittedAt: { $ne: null } })
        .select("_id submittedAt").lean();
      if (submitted) return { submission: submitted, replayed: true };
    }
    throw error;
  }
}
