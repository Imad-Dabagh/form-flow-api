import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authorize, validate } from "#app/middlewares/index";
import { DEFAULT_FORM_SUBMISSION_STATUSES, FORM_TYPES } from "#app/modules/_shared/constants";
import FormSubmissionStatusModule from "#app/modules/form-submission-status/index";
import FormModule from "#app/modules/form/index";
import { internalError } from "#app/utils/errors";

const router = Router({ mergeParams: true });
const PAGE_SIZE = 20;

interface FormListItem {
  _id: unknown;
  name: string;
  type: string;
  displayMode?: string;
  isClosed?: boolean;
  isReviewEnabled?: boolean;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * GET /api/orgs/:organizationSlug/forms
 */
router.get(
  "/",
  authorize("form.read"),
  validate({
    query: z.object({
      page: z
        .string()
        .refine(
          (value) =>
            /^[1-9]\d*$/.test(value) &&
            Number.isSafeInteger(Number(value)) &&
            (Number(value) - 1) * PAGE_SIZE <= Number.MAX_SAFE_INTEGER,
          {
            message: "page must be a positive integer.",
          },
        )
        .optional(),
      search: z.string().trim().max(100).optional(),
      type: z.enum(FORM_TYPES).optional(),
      status: z.enum(["active", "archived"]).optional(),
      closed: z.enum(["open", "closed"]).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const page = Number(req.query.page ?? 1);
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      const status = req.query.status ?? "active";
      const scope = {
        organizationId: req.organizationAccess!.organizationId,
        archivedAt: status === "archived" ? { $ne: null } : null,
        ...(req.query.type ? { type: req.query.type } : {}),
        ...(status === "active" && req.query.closed
          ? { isClosed: req.query.closed === "closed" }
          : {}),
        ...(search ? { name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") } : {}),
      };
      const result = await FormModule.services.fetchAll({
        query: scope,
        selection: "name type displayMode isClosed archivedAt createdAt updatedAt",
        sort: { createdAt: -1, _id: -1 },
        page,
        limit: PAGE_SIZE,
      });

      return res.status(200).json({
        success: true,
        data: {
          items: (result.docs as FormListItem[]).map((form) => ({
            id: String(form._id),
            name: form.name,
            type: form.type,
            displayMode: form.displayMode ?? "SINGLE_PAGE",
            isClosed: form.isClosed ?? false,
            archivedAt: form.archivedAt ?? null,
            createdAt: form.createdAt,
            updatedAt: form.updatedAt,
          })),
          total: result.totalDocs,
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
  authorize("form.create"),
  validate({
    body: z.strictObject({
      name: z
        .string({ error: "name is required." })
        .trim()
        .min(1, "name is required.")
        .max(100, "name must be 100 characters or fewer."),
      type: z.enum(FORM_TYPES),
      displayMode: z.enum(["SINGLE_PAGE", "WIZARD"]),
      isClosed: z.boolean(),
      isReviewEnabled: z.boolean().optional(),
    }),
  }),
  async (req, res, next) => {
    const session = await mongoose.startSession();

    try {
      const form = await session.withTransaction(async () => {
        const createdForm = (await FormModule.services.createOne({
          payload: {
            organizationId: req.organizationAccess!.organizationId,
            createdBy: req.auth!.userId,
            name: req.body.name.trim(),
            type: req.body.type,
            displayMode: req.body.displayMode,
            isClosed: req.body.isClosed,
            isReviewEnabled: req.body.isReviewEnabled ?? false,
          },
          session,
        })) as FormListItem;

        await FormSubmissionStatusModule.services.createMany({
          payload: DEFAULT_FORM_SUBMISSION_STATUSES.map((status) => ({
            ...status,
            organizationId: req.organizationAccess!.organizationId,
            formId: createdForm._id,
          })),
          session,
        });

        return createdForm;
      });

      if (!form) throw internalError();

      return res.status(201).json({
        success: true,
        data: {
          id: String(form._id),
          name: form.name,
          type: form.type,
          displayMode: form.displayMode,
          isClosed: form.isClosed,
          isReviewEnabled: form.isReviewEnabled ?? false,
          createdAt: form.createdAt,
          updatedAt: form.updatedAt,
        },
      });
    } catch (error) {
      return next(error);
    } finally {
      await session.endSession();
    }
  },
);

export default router;
