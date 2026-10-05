import { Router } from "express";
import statusRoutes from "./status.js";

const router = Router({ mergeParams: true });

router.use("/status", statusRoutes);

export default router;
