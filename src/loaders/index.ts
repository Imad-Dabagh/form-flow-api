
import type { Express } from "express";
import { createAuth } from "#app/auth/index";
import { Logger } from "#app/services/index";
import expressLoader from "./express/index.js";
import mongooseLoader from "./mongoose/index.js";

export default async function loadApplication(app: Express): Promise<void> {
  const mongo = await mongooseLoader();
  Logger.info("✅ DB loaded and connected!");

  expressLoader(app, createAuth(mongo.database, mongo.client));
  Logger.info("✅ Express app loaded!");
}
