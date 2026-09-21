import cors from "cors";
import express from "express";
import type { Express } from "express";
import config from "../../config";
import { attachJwt, handleErrors, requestContext } from "../../middlewares";
import { notFound } from "../../utils/errors";
import authRoutes from "../../routes/auth";
import meRoutes from "../../routes/me";
import organizationRoutes from "../../routes/orgs";

export default function expressLoader(app: Express): void {
  app.disable("x-powered-by");
  app.set("trust proxy", config.isProduction);

  app.use(requestContext);
  app.use(attachJwt);
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  app.get("/health", (_, res) => {
    res.status(200).json({
      status: "ok",
      uptime: process.uptime(),
    });
  });

  app.use("/auth", authRoutes);
  app.use("/me", meRoutes);
  app.use("/orgs", organizationRoutes);

  app.use((_req, _res, next) => next(notFound("Endpoint")));
  app.use(handleErrors);
}
