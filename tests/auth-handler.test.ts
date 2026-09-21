import express from "express";
import { MongoClient } from "mongodb";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/index.js";
import expressLoader from "../src/loaders/express/index.js";

function createApp() {
  const client = new MongoClient("mongodb://127.0.0.1:27017/form-flow-test");
  const app = express();
  expressLoader(app, createAuth(client.db(), client));
  return app;
}

describe("Better Auth Express integration", () => {
  it("mounts the Better Auth health endpoint before JSON body parsing", async () => {
    const response = await request(createApp()).get("/api/auth/ok");

    expect(response.status).toBe(200);
  });

  it("allows configured origins to send credentialed requests", async () => {
    const response = await request(createApp())
      .options("/api/me")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
});
