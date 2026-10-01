import { Router } from "express";
import rootRoutes from "./root.js";
import submitRoutes from "./submit.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/submissions/submit", submitRoutes);

export default router;
