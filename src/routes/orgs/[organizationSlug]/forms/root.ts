import { Router } from "express";
import { z } from "zod";
import { authenticate, authorize, currentOrganizationBySlug, organizationAccess, validate } from "#app/middlewares/index";
import Form from "#app/modules/form/models/index";

const router = Router({ mergeParams: true });
const PAGE_SIZE = 20;

/**
 * GET /api/orgs/:organizationSlug/forms
 */
router.get(
  "/",
  authenticate,
  currentOrganizationBySlug,
  organizationAccess,
  authorize("form.read"),
  validate({
    query: z.object({
      page: z.string()
        .refine((value) => /^[1-9]\d*$/.test(value)
          && Number.isSafeInteger(Number(value))
          && (Number(value) - 1) * PAGE_SIZE <= Number.MAX_SAFE_INTEGER, {
          message: "page must be a positive integer.",
        })
        .optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const page = Number(req.query.page ?? 1);
      const scope = {
        organizationId: req.organizationAccess!.organizationId,
        archivedAt: null,
      };
      const [forms, total] = await Promise.all([
        Form.find(scope)
          .select("name createdAt updatedAt")
          .sort({ updatedAt: -1, _id: -1 })
          .skip((page - 1) * PAGE_SIZE)
          .limit(PAGE_SIZE)
          .lean(),
        Form.countDocuments(scope),
      ]);

      return res.status(200).json({
        success: true,
        data: {
          items: forms.map((form) => ({
            id: String(form._id),
            name: form.name,
            createdAt: form.createdAt,
            updatedAt: form.updatedAt,
          })),
          total,
          page,
          pageSize: PAGE_SIZE,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * POST /api/orgs/:organizationSlug/forms
 */
router.post(
  "/",
  authenticate,
  currentOrganizationBySlug,
  organizationAccess,
  authorize("form.create"),
  validate({
    body: z.strictObject({
      name: z.string({ error: "name is required." }).trim()
        .min(1, "name is required.")
        .max(100, "name must be 100 characters or fewer."),
    }, { error: "Only name can be provided." }),
  }),
  async (req, res, next) => {
    try {
      const form = await Form.create({
        organizationId: req.organizationAccess!.organizationId,
        createdBy: req.auth!.userId,
        name: req.body.name.trim(),
      });

      return res.status(201).json({
        success: true,
        data: {
          id: String(form._id),
          name: form.name,
          createdAt: form.createdAt,
          updatedAt: form.updatedAt,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
