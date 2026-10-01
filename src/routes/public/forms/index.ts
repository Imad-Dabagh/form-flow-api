import { Router } from "express";
import formIdRoutes from "./[formId]/index.js";

const router = Router();

router.use("/:formId", formIdRoutes);

export default router;
