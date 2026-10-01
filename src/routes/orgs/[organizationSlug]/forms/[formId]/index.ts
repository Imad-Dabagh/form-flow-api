import { Router } from "express";
import rootRoutes from "./root.js";
import responseRoutes from "./response.js";
import settingsRoutes from "./settings.js";
import submitRoutes from "./submit.js";
import uploadQuestionRoutes from "./upload-question.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/response", responseRoutes);
router.use("/submissions/submit", submitRoutes);
router.use("/settings", settingsRoutes);
router.use("/questions/:questionId/uploads", uploadQuestionRoutes);

export default router;
