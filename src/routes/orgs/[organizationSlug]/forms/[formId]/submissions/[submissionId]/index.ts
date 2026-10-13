import { Router } from "express";
import rootRoutes from "./root.js";
import statusHistoryRoutes from "./status-history.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/status-history", statusHistoryRoutes);

export default router;
