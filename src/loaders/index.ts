
import type { Express } from "express";
import { createAuth } from "../auth/index.js";
import { Logger } from "../services/index.js";
import expressLoader from "./express/index.js";
import mongooseLoader from "./mongoose/index.js";

export default async function loadApplication(app: Express): Promise<void> {
  const mongo = await mongooseLoader();
  Logger.info("✅ DB loaded and connected!");

  expressLoader(app, createAuth(mongo.database, mongo.client));
  Logger.info("✅ Express app loaded!");
}
