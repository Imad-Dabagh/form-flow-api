import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { validate } from "#app/middlewares/index";
import Form from "#app/modules/form/models/index";
import { notFound } from "#app/utils/errors";

const router = Router({ mergeParams: true });

/** GET /api/public/forms/:formId */
router.get(
  "/",
  validate({
    params: z.object({
      formId: z.string().refine(mongoose.isValidObjectId, "A valid form ID is required."),
    }),
  }),
  async (req, res, next) => {
    try {
      const form = await Form.findOne({
        _id: req.params.formId,
        type: "PUBLIC",
        archivedAt: null,
      }).select("name type description sections displayMode isClosed").lean();
      if (!form) throw notFound("Form");

      // Construct the public view explicitly so answer keys and internal metadata never leave the API.
      const sections = form.sections
        .filter((section) => !section.isHidden)
        .map((section) => ({
          _id: section._id,
          title: section.title,
          description: section.description,
          questions: section.questions.map((question) => ({
            _id: question._id,
            title: question.title,
            description: question.description,
            placeholder: question.placeholder,
            inputType: question.inputType,
            isRequired: question.isRequired,
            options: question.options?.map((option) => ({
              label: option.label,
              value: option.value,
            })),
            typeConfig: question.typeConfig,
            validation: question.validation,
            defaultValue: question.defaultValue,
          })),
        }));

      res.set("Cache-Control", "no-store");
      return res.status(200).json({
        success: true,
        data: {
          id: String(form._id),
          type: form.type,
          name: form.name,
          description: form.description,
          sections,
          displayMode: form.displayMode,
          isClosed: form.isClosed,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
