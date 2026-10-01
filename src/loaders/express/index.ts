import cors from "cors";
import express from "express";
import type { Express } from "express";
import { toNodeHandler } from "better-auth/node";
import type { Auth } from "#app/auth/index";
import config from "#app/config/index";
import { createAttachSession, handleErrors, requestContext } from "#app/middlewares/index";
import { notFound } from "#app/utils/errors";
import healthRoutes from "#app/routes/health/index";
import invitationRoutes from "#app/routes/invitations/index";
import meRoutes from "#app/routes/me/index";
import organizationRoutes from "#app/routes/orgs/index";
import publicRoutes from "#app/routes/public/index";
import uploadRoutes from "#app/routes/upload/index";

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
  app.use("/api/public", publicRoutes);
  app.use(createAttachSession(auth));

  app.use("/health", healthRoutes);

  app.use("/api/me", meRoutes);
  app.use("/api/upload", uploadRoutes);
  app.use("/api/orgs", organizationRoutes);
  app.use("/api/invitations", invitationRoutes);

  app.use((_req, _res, next) => next(notFound("Endpoint")));
  app.use(handleErrors);
}
