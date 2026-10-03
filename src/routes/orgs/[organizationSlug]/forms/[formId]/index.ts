import { Router } from "express";
import rootRoutes from "./root.js";
import formSubmissionRoutes from "./form-submission.js";
import draftRoutes from "./drafts.js";
import listSubmissionsRoutes from "./list-submissions.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/", formSubmissionRoutes);
router.use("/submissions/drafts", draftRoutes);
router.use("/submissions", listSubmissionsRoutes);

export default router;
