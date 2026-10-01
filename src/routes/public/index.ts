import { Router } from "express";
import formRoutes from "./forms/index.js";

const router = Router();

router.use("/forms", formRoutes);

export default router;
