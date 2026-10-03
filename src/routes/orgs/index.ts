import { Router } from "express";
import { authenticate, currentOrganizationBySlug, organizationAccess } from "#app/middlewares/index";
import organizationRoutes from "./[organizationSlug]/index.js";
import { submissionAccessRoutes } from "./[organizationSlug]/forms/[formId]/form-submission.js";
import rootRoutes from "./root.js";

const router = Router();

router.use(authenticate);
router.use("/", rootRoutes);
router.use(
  "/:organizationSlug/forms/:formId/submission/access",
  currentOrganizationBySlug,
  submissionAccessRoutes,
);
router.use(
  "/:organizationSlug",
  currentOrganizationBySlug,
  organizationAccess,
  organizationRoutes,
);

export default router;
