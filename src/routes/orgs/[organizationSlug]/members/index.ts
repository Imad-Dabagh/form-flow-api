import { Router } from "express";
import membershipRoutes from "./[membershipId]/index.js";
import lookupRoutes from "./lookup.js";
import rootRoutes from "./root.js";

const router = Router({ mergeParams: true });

router.use("/", rootRoutes);
router.use("/lookup", lookupRoutes);
router.use("/:membershipId", membershipRoutes);

export default router;
