import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handleErrors from "../src/middlewares/handle-errors.js";
import { Logger } from "../src/services/index.js";
import { AppError } from "../src/utils/errors.js";

beforeEach(() => {
  vi.spyOn(Logger, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function createApp() {
  const app = express();
  app.use(express.json({ limit: 64 }));
  app.use(express.urlencoded({ extended: true, parameterLimit: 1, depth: 1 }));
  app.post("/", (_req, res) => res.sendStatus(204));
  app.use(handleErrors);
  return app;
}

describe("HTTP error boundary", () => {
  it("returns 413 for oversized JSON without exposing its contents", async () => {
    const response = await request(createApp())
      .post("/")
      .send({ secret: "x".repeat(100) });
    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      success: false,
      error: { code: "PAYLOAD_TOO_LARGE", message: "The request payload is too large." },
    });
    expect(JSON.stringify(response.body)).not.toContain("secret");
  });

  it("preserves the malformed JSON response", async () => {
    const response = await request(createApp()).post("/").type("json").send('{"secret":');
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Malformed JSON request body.");
  });

  it("returns 415 for unsupported encodings", async () => {
    const response = await request(createApp())
      .post("/")
      .set("Content-Type", "application/json; charset=iso-8859-1")
      .send("{}");
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("returns 413 for too many form parameters", async () => {
    const response = await request(createApp()).post("/").type("form").send("a=1&b=2");
    expect(response.status).toBe(413);
  });

  it("returns 400 for form bodies exceeding the nesting limit", async () => {
    const response = await request(createApp()).post("/").type("form").send("a[b][c]=1");
    expect(response.status).toBe(400);
  });

  it.each([200, 600, NaN, 400.5])(
    "safely rejects invalid application status %s",
    async (statusCode) => {
      const app = express();
      app.get("/", () => {
        throw new AppError("private", { statusCode, code: "INVALID" });
      });
      app.use(handleErrors);
      const response = await request(app).get("/");
      expect(response.status).toBe(500);
      expect(response.body.error).toEqual({
        code: "INTERNAL_ERROR",
        message: "Something went wrong.",
      });
    },
  );

  it("delegates the original error without writing after headers are sent", () => {
    const error = new Error("stream failed");
    const next = vi.fn();
    const res = { headersSent: true, status: vi.fn(), json: vi.fn() };
    handleErrors(error, {} as express.Request, res as unknown as express.Response, next);
    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
