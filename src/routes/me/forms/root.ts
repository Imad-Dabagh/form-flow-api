import { Router } from "express";
import { authenticate } from "#app/middlewares/index";

const router = Router();

router.use(authenticate);

export default router;
