import { Router } from "express";
import rootRoutes from "./root.js";
import submissionRoutes from "./submissions/index.js";
import submissionStatusRoutes from "./submission-statuses/index.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/submissions", submissionRoutes);
router.use("/submission-statuses", submissionStatusRoutes);

export default router;
