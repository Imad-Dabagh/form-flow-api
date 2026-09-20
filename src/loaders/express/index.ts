import cors from "cors";
import express from "express";
import type { Express } from "express";
import { attachJwt, handleErrors, requestContext } from "../../middlewares";
import { notFound } from "../../utils/errors";
import authRoutes from "../../routes/auth";
import meRoutes from "../../routes/me";

function getCorsOrigins(): string[] | true {
  const configuredOrigins = process.env.CORS_ORIGINS;

  if (!configuredOrigins) {
    return true;
  }

  return configuredOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export default function expressLoader(app: Express): void {
  app.disable("x-powered-by");
  app.set("trust proxy", process.env.NODE_ENV === "production");

  app.use(requestContext);
  app.use(attachJwt);
  app.use(cors({ origin: getCorsOrigins() }));
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

  app.use((_req, _res, next) => next(notFound("Endpoint")));
  app.use(handleErrors);
}
