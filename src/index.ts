import express from "express";
import config from "./config";
import loaders from "./loaders";
import { Logger } from "./services";

async function start() {
  const app = express();

  await loaders(app);

  app.listen(config.port, () => {
    Logger.info(`✅ Server listening on http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  Logger.error("Server failed to start", error);
  process.exitCode = 1;
});
