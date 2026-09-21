import cors from "cors";
import express from "express";
import type { Express } from "express";
import { toNodeHandler } from "better-auth/node";
import type { Auth } from "../../auth/index.js";
import config from "../../config/index.js";
import { createAttachSession, handleErrors, requestContext } from "../../middlewares/index.js";
import { notFound } from "../../utils/errors.js";
import meRoutes from "../../routes/me/index.js";
import organizationRoutes from "../../routes/orgs/index.js";

export default function expressLoader(app: Express, auth: Auth): void {
  app.disable("x-powered-by");
  app.set("trust proxy", config.isProduction);

  app.use(requestContext);
  app.use(cors({ origin: config.corsOrigins, credentials: true }));

  /**
   * ALL /api/auth/*splat
   */
  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(createAttachSession(auth));

  app.get("/health", (_, res) => {
    res.status(200).json({
      status: "ok",
      uptime: process.uptime(),
    });
  });

  app.use("/api/me", meRoutes);
  app.use("/api/orgs", organizationRoutes);

  app.use((_req, _res, next) => next(notFound("Endpoint")));
  app.use(handleErrors);
}
