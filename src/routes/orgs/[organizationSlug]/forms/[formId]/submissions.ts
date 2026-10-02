import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import Form from "#app/modules/form/models/index";
import FormSubmission from "#app/modules/form-submission/models/index";
import { notFound } from "#app/utils/errors";

const router = Router({ mergeParams: true });
const PAGE_SIZE = 20;
const formIdSchema = z.string().refine(mongoose.isValidObjectId, {
  message: "A valid form ID is required.",
});

/** GET /api/orgs/:organizationSlug/forms/:formId/submissions */
router.get(
  "/",
  authorize("submission.read"),
  validate({ params: z.object({ formId: formIdSchema }) }),
  async (req, res, next) => {
    try {
      const organizationId = req.organizationAccess!.organizationId;
      const formId = req.params.formId;
      const form = await Form.exists({ _id: formId, organizationId, archivedAt: null });
      if (!form) throw notFound("Form");

      const submissions = await FormSubmission.find({ formId, organizationId })
        .select("_id createdAt")
        .sort({ createdAt: -1, _id: -1 })
        .limit(PAGE_SIZE)
        .lean();

      return res.status(200).json({
        success: true,
        data: {
          items: submissions.map((submission) => ({
            id: String(submission._id),
            submittedAt: submission.createdAt,
          })),
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
