import { Router } from "express";
import organizationRoutes from "./[organizationSlug]/index.js";
import rootRoutes from "./root.js";

const router = Router();

router.use("/", rootRoutes);
router.use("/:organizationSlug", organizationRoutes);

export default router;
