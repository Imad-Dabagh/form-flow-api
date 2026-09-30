import { Router } from "express";
import formRoutes from "./[formId]/index.js";
import rootRoutes from "./root.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/:formId", formRoutes);

export default router;
