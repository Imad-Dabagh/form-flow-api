import { Router } from "express";
import invitationRoutes from "./invitations/index.js";
import memberRoutes from "./members/index.js";
import rootRoutes from "./root.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/members", memberRoutes);
router.use("/invitations", invitationRoutes);

export default router;
