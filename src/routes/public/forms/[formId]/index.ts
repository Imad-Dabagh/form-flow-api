import { Router } from "express";
import rootRoutes from "./root.js";
import linkRoutes from "./link.js";
import submitRoutes from "./submit.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/link", linkRoutes);
router.use("/submissions/submit", submitRoutes);

export default router;
