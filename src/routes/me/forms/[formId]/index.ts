import { Router } from "express";
import rootRoutes from "./root.js";
import submissionRoutes from "./submission/index.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/submission", submissionRoutes);

export default router;
