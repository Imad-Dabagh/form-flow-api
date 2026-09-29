import { Router } from "express";
import rootRoutes from "./root.js";

const router = Router();

router.use("/", rootRoutes);

export default router;
