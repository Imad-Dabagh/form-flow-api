
import type { Express } from "express";
import expressLoader from "./express";
import mongooseLoader from "./mongoose";
import { Logger } from "../services";

export default async function loadApplication(app: Express): Promise<void> {
  await mongooseLoader();
  Logger.info("✅ DB loaded and connected!");

  expressLoader(app);
  Logger.info("✅ Express app loaded!");
}
