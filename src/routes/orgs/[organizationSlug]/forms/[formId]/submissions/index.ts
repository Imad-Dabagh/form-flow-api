import { Router } from "express";
import rootRoutes from "./root.js";
import submissionRoutes from "./[submissionId]/index.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/:submissionId", submissionRoutes);

export default router;
