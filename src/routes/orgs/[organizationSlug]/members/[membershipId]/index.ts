import { Router } from "express";
import rootRoutes from "./root.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);

export default router;
