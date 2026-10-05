import { Router } from "express";
import rootRoutes from "./root.js";
import listSubmissionsRoutes from "./list-submissions.js";
import submissionRoutes from "./submissions/[submissionId]/index.js";
import submissionStatusRoutes from "./submission-statuses/index.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/submissions", listSubmissionsRoutes);
router.use("/submissions/:submissionId", submissionRoutes);
router.use("/submission-statuses", submissionStatusRoutes);

export default router;
