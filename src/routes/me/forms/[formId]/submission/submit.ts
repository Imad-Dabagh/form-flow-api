import { Router } from "express";
import FormSubmission from "#app/modules/form-submission/models/index";
import { conflict } from "#app/utils/errors";
import {
  assertEditable,
  findForm,
  findSubmission,
  submissionData,
  validateSavedAnswers,
  type Submission,
} from "#app/modules/form-submission/services/current-user-submission";

const router = Router({ mergeParams: true });

/** PUT /api/me/forms/:formId/submission/submit — validate and finish. */
router.put<{ formId: string }>("/", async (req, res, next) => {
  try {
    const form = await findForm(req.params.formId);
    const submission = await findSubmission(form, req.auth!.userId);
    if (submission.submittedAt) {
      return res.status(200).json({ success: true, data: submissionData(submission) });
    }
    await assertEditable(form, submission);

    const answers = validateSavedAnswers(form, submission.answers);
    const updated = await FormSubmission.findOneAndUpdate(
      { _id: submission._id, submissionStatusId: submission.submissionStatusId,
        submittedAt: null },
      { $set: { answers, submittedAt: new Date() } },
      { returnDocument: "after", runValidators: true },
    ).lean() as Submission | null;
    if (updated) return res.status(200).json({ success: true, data: submissionData(updated) });

    const latest = await findSubmission(form, req.auth!.userId);
    if (latest.submittedAt) return res.status(200).json({ success: true, data: submissionData(latest) });
    throw conflict("This submission changed while submitting. Reload it and try again.");
  } catch (error) {
    return next(error);
  }
});

export default router;
