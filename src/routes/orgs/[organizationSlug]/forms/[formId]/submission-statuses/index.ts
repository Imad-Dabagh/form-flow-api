import { Router } from "express";
import rootRoutes from "./root.js";
import reorderRoutes from "./reorder.js";
import submissionStatusRoutes from "./[submissionStatusId]/index.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/reorder", reorderRoutes);
router.use("/:submissionStatusId", submissionStatusRoutes);

export default router;
