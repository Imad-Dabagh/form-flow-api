import { Router } from "express";
import { authenticate, currentOrganizationBySlug, organizationAccess } from "#app/middlewares/index";
import organizationRoutes from "./[organizationSlug]/index.js";
import responseAccessRoutes from "./[organizationSlug]/forms/[formId]/response-access.js";
import rootRoutes from "./root.js";

const router = Router();

router.use(authenticate);
router.use("/", rootRoutes);
router.use(
  "/:organizationSlug/forms/:formId/response/access",
  currentOrganizationBySlug,
  responseAccessRoutes,
);
router.use(
  "/:organizationSlug",
  currentOrganizationBySlug,
  organizationAccess,
  organizationRoutes,
);

export default router;
