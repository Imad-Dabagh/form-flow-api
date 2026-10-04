import { Router } from "express";
import { authenticate, currentOrganizationBySlug, organizationAccess } from "#app/middlewares/index";
import organizationRoutes from "./[organizationSlug]/index.js";
import rootRoutes from "./root.js";

const router = Router();

router.use(authenticate);
router.use("/", rootRoutes);
router.use(
  "/:organizationSlug",
  currentOrganizationBySlug,
  organizationAccess,
  organizationRoutes,
);

export default router;
