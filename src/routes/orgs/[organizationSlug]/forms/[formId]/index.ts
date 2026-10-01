import { Router } from "express";
import rootRoutes from "./root.js";
import uploadQuestionRoutes from "./upload-question.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/questions/:questionId/uploads", uploadQuestionRoutes);

export default router;
