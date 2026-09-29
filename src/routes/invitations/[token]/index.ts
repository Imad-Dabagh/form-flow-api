import { Router } from "express";
import acceptRoutes from "./accept.js";
import rootRoutes from "./root.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/accept", acceptRoutes);

export default router;
