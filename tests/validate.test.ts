import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import validate from "../src/middlewares/validate.js";
import { AppError } from "../src/utils/errors.js";

function createApp() {
  const app = express();
  app.use(express.json());
  return app;
}

function attachErrorHandler(app: express.Express) {
  app.use(
    (
      error: AppError,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(error.statusCode ?? 500).json({ code: error.code, message: error.message });
    },
  );
}

describe("request validation", () => {
  it("passes normalized body, params, and query values to the handler", async () => {
    const app = createApp();
    app.post(
      "/items/:itemId",
      validate({
        params: z.object({ itemId: z.string().toLowerCase() }),
        body: z.object({
          name: z.string().trim(),
          enabled: z.boolean().default(true),
        }),
        query: z.object({
          page: z.coerce.number().int().positive(),
          search: z.string().trim(),
          limit: z.coerce.number().default(20),
        }),
      }),
      (req, res) => res.json({ body: req.body, params: req.params, query: req.query }),
    );
    attachErrorHandler(app);

    const response = await request(app)
      .post("/items/ABC")
      .query({ page: "2", search: "  feedback  ", ignored: "query value" })
      .send({ name: "  Survey  ", ignored: "body value" })
      .expect(200);

    expect(response.body).toEqual({
      body: { name: "Survey", enabled: true },
      params: { itemId: "abc" },
      query: { page: 2, search: "feedback", limit: 20 },
    });
  });

  it("leaves segments without a schema available to the handler", async () => {
    const app = createApp();
    app.post(
      "/items/:itemId",
      validate({ body: z.strictObject({ name: z.string().trim() }) }),
      (req, res) => res.json({ body: req.body, params: req.params, query: req.query }),
    );
    attachErrorHandler(app);

    const response = await request(app)
      .post("/items/ABC?search=original")
      .send({ name: "  Survey  " })
      .expect(200);

    expect(response.body).toEqual({
      body: { name: "Survey" },
      params: { itemId: "ABC" },
      query: { search: "original" },
    });
  });

  it.each(["params", "body", "query"] as const)(
    "rejects invalid %s before the handler runs",
    async (source) => {
      const app = createApp();
      const handler = vi.fn((_req: express.Request, res: express.Response) => res.sendStatus(204));
      app.post(
        "/items/:itemId",
        validate({
          params: z.object({ itemId: z.literal("valid") }),
          body: z.strictObject({ name: z.string().trim().min(1) }),
          query: z.strictObject({ page: z.coerce.number().int().positive() }),
        }),
        handler,
      );
      attachErrorHandler(app);

      const response = await request(app)
        .post(`/items/${source === "params" ? "invalid" : "valid"}`)
        .query(source === "query" ? { page: "1", unexpected: "value" } : { page: "1" })
        .send(source === "body" ? { name: "Survey", unexpected: "value" } : { name: "Survey" })
        .expect(400);

      expect(response.body.code).toBe("BAD_REQUEST");
      expect(handler).not.toHaveBeenCalled();
    },
  );
});
