import "dotenv/config";
import express from "express";
import loaders from "./loaders";
import { Logger } from "./services";

async function start() {
  const app = express();

  await loaders(app);

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    Logger.info(`✅ Server listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  Logger.error("Server failed to start", error);
  process.exitCode = 1;
});
