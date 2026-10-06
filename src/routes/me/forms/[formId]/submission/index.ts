import { Router } from "express";
import rootRoutes from "./root.js";
import submitRoutes from "./submit.js";
import fileRoutes from "./files/index.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/submit", submitRoutes);
router.use("/files", fileRoutes);

export default router;
