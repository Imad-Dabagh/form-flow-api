import { Router } from "express";
import rootRoutes from "./root.js";
import listSubmissionsRoutes from "./list-submissions.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/submissions", listSubmissionsRoutes);

export default router;
