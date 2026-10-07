import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import { FORM_TYPES } from "#app/modules/_shared/constants";
import { authenticatedUploadRateLimit } from "#app/modules/file-upload/authenticated-rate-limit";
import Form from "#app/modules/form/models/index";
import { uploadQuestionFile } from "#app/modules/form-submission/services/index";
import { badRequest, notFound } from "#app/utils/errors";
import { updateFormSchema } from "#app/modules/form/validation";

const router = Router({ mergeParams: true });
const formIdSchema = z.string().refine(mongoose.isValidObjectId, {
  message: "A valid form ID is required.",
});

type FormDataSource = {
  _id: unknown;
  name: string;
  type: string;
  description: string;
  sections: unknown[];
  displayMode?: string;
  isClosed?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toFormData(form: FormDataSource) {
  return {
    id: String(form._id),
    name: form.name,
    type: form.type,
    description: form.description,
    sections: form.sections,
    displayMode: form.displayMode ?? "SINGLE_PAGE",
    isClosed: form.isClosed ?? false,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
  };
}

/**
 * GET /api/orgs/:organizationSlug/forms/:formId
 */
router.get(
  "/",
  authorize("form.read"),
  validate({
    params: z.object({
      formId: formIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const form = await Form.findOne({
        _id: req.params.formId,
        organizationId: req.organizationAccess!.organizationId,
        archivedAt: null,
      })
        .select("name type description sections displayMode isClosed createdAt updatedAt")
        .lean();
      if (!form) throw notFound("Form");

      return res.status(200).json({
        success: true,
        data: toFormData(form),
      });
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * PUT /api/orgs/:organizationSlug/forms/:formId
 */
router.put(
  "/",
  authorize("form.update"),
  validate({
    params: z.object({ formId: formIdSchema }),
    body: updateFormSchema,
  }),
  async (req, res, next) => {
    try {
      const form = await Form.findOneAndUpdate(
        {
          _id: req.params.formId,
          organizationId: req.organizationAccess!.organizationId,
          archivedAt: null,
        },
        { $set: req.body },
        { new: true, runValidators: true },
      ).select("name type description sections displayMode isClosed createdAt updatedAt");
      if (!form) throw notFound("Form");

      return res.status(200).json({ success: true, data: toFormData(form) });
    } catch (error) {
      return next(error);
    }
  },
);

/** PUT /api/orgs/:organizationSlug/forms/:formId/settings */
router.put(
  "/settings",
  authorize("form.update"),
  validate({
    params: z.object({ formId: formIdSchema }),
    body: z.strictObject({
      name: z.string().trim().min(1).max(100),
      type: z.enum(FORM_TYPES),
      displayMode: z.enum(["SINGLE_PAGE", "WIZARD"]),
      isClosed: z.boolean(),
    }),
  }),
  async (req, res, next) => {
    try {
      const form = await Form.findOneAndUpdate(
        {
          _id: req.params.formId,
          organizationId: req.organizationAccess!.organizationId,
          archivedAt: null,
        },
        { $set: {
          name: req.body.name.trim(),
          type: req.body.type,
          displayMode: req.body.displayMode,
          isClosed: req.body.isClosed,
        } },
        { new: true, runValidators: true },
      ).select("name type displayMode isClosed updatedAt");
      if (!form) throw notFound("Form");

      return res.status(200).json({
        success: true,
        data: {
          id: String(form._id),
          name: form.name,
          type: form.type,
          displayMode: form.displayMode,
          isClosed: form.isClosed,
          updatedAt: form.updatedAt,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

/** PUT /api/orgs/:organizationSlug/forms/:formId/archive */
router.put(
  "/archive",
  authorize("form.update"),
  validate({
    params: z.object({ formId: formIdSchema }),
    body: z.strictObject({ archived: z.boolean() }),
  }),
  async (req, res, next) => {
    try {
      const form = await Form.findOneAndUpdate(
        {
          _id: req.params.formId,
          organizationId: req.organizationAccess!.organizationId,
        },
        { $set: { archivedAt: req.body.archived ? new Date() : null } },
        { new: true },
      ).select("_id archivedAt");
      if (!form) throw notFound("Form");

      return res.status(200).json({
        success: true,
        data: { id: String(form._id), archivedAt: form.archivedAt },
      });
    } catch (error) {
      return next(error);
    }
  },
);

/** POST /api/orgs/:organizationSlug/forms/:formId/questions/:questionId/uploads */
router.post(
  "/questions/:questionId/uploads",
  authorize("form.update"),
  authenticatedUploadRateLimit,
  validate({
    params: z.object({ formId: formIdSchema, questionId: z.string().min(1).max(128) }),
  }),
  async (req, res, next) => {
    try {
      const questionId = req.params.questionId;
      if (typeof questionId !== "string") throw badRequest("A valid question ID is required.");
      const form = await Form.findOne({
        _id: req.params.formId,
        organizationId: req.organizationAccess!.organizationId,
        archivedAt: null,
      }).select("organizationId isClosed sections").lean();
      if (!form) throw notFound("Form");
      const file = await uploadQuestionFile({ request: req, form, questionId });
      return res.status(201).json({ success: true, data: file });
    } catch (error) { return next(error); }
  },
);

export default router;
