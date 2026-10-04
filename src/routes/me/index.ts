import { Router } from "express";
import { authenticate } from "#app/middlewares/index";
import formRoutes from "./forms/index.js";
import rootRoutes from "./root.js";

const router = Router();

router.use("/", rootRoutes);
router.use("/forms", authenticate, formRoutes);

export default router;
