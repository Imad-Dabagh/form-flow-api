import { Router } from "express";
import tokenRoutes from "./[token]/index.js";

const router = Router();

router.use("/:token", tokenRoutes);

export default router;
