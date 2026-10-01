import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { validate } from "#app/middlewares/index";
import { ORGANIZATION_ROLES } from "#app/modules/_shared/constants";
import Form from "#app/modules/form/models/index";
import Membership from "#app/modules/membership/models/index";
import { notFound } from "#app/utils/errors";

const router = Router({ mergeParams: true });

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === 11000;
}

/** PUT /api/orgs/:organizationSlug/forms/:formId/response/access */
router.put(
  "/",
  validate({
    params: z.object({
      organizationSlug: z.string(),
      formId: z.string().refine(mongoose.isValidObjectId, "A valid form ID is required."),
    }),
  }),
  async (req, res, next) => {
    try {
      const organizationId = req.organization!.organizationId;
      const form = await Form.findOne({
        _id: req.params.formId,
        organizationId,
        type: { $in: ["AUTHENTICATED", null] },
        archivedAt: null,
      }).select("_id").lean();
      if (!form) throw notFound("Form");

      const membershipQuery = { userId: req.auth!.userId, organizationId };
      try {
        await Membership.updateOne(
          membershipQuery,
          { $setOnInsert: { role: ORGANIZATION_ROLES.USER } },
          { upsert: true },
        );
      } catch (error) {
        if (!isDuplicateKey(error) || !await Membership.exists(membershipQuery)) throw error;
      }
      return res.status(200).json({ success: true, data: { granted: true } });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
