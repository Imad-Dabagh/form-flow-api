import { createServer } from "node:http";
import express from "express";
import mongoose from "mongoose";
import config from "./config/index.js";
import loaders from "./loaders/index.js";
import { Logger } from "./services/index.js";

const app = express();
const server = createServer(app);
let shuttingDown = false;
let shutdownExitCode = 0;

async function start() {
  await loaders(app);
  if (shuttingDown) return;

  server.listen(config.port, () => {
    Logger.info(`✅ Server listening on http://localhost:${config.port}`);
  });
}

async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (exitCode !== 0) shutdownExitCode = exitCode;
  if (shuttingDown) return;
  shuttingDown = true;
  Logger.info("Server shutting down", { reason });

  const deadline = setTimeout(() => {
    Logger.error("Shutdown deadline exceeded; closing remaining connections.");
    server.closeAllConnections();
    process.exit(1);
  }, config.shutdownTimeoutMs);
  deadline.unref();

  try {
    // If shutdown arrives during initialization, let startup settle before
    // closing MongoDB. start() will skip listening once shutdown begins.
    await startup.catch(() => undefined);

    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
    }

    await mongoose.disconnect();
    Logger.info("Server shutdown complete.");
  } catch (error) {
    Logger.error("Server shutdown failed", error);
    shutdownExitCode = 1;
  }

  clearTimeout(deadline);
  process.exit(shutdownExitCode);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
server.on("error", (error) => {
  Logger.error("HTTP server failed", error);
  void shutdown("HTTP server failure", 1);
});

const startup = start();
void startup.catch((error) => {
  Logger.error("Server failed to start", error);
  void shutdown("Startup failure", 1);
});
