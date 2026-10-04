import { Router } from "express";
import rootRoutes from "./root.js";

const router = Router();

router.use("/:formId/submission", rootRoutes);

export default router;
