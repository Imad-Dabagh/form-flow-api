import { Router } from "express";
import invitationRoutes from "./[invitationId]/index.js";
import rootRoutes from "./root.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/:invitationId", invitationRoutes);

export default router;
