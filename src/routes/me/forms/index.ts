import { Router } from "express";
import rootRoutes from "./root.js";
import formRoutes from "./[formId]/index.js";

const router = Router();

router.use("/", rootRoutes);
router.use("/:formId", formRoutes);

export default router;
