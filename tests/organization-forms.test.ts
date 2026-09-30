import express from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const alphaId = "000000000000000000000001";
const betaId = "000000000000000000000002";
const userId = "000000000000000000000003";

vi.mock("../src/middlewares/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/middlewares/index.js")>();
  return {
    ...actual,
    authenticate: (req: { auth?: unknown }, _res: unknown, next: () => void) => {
      req.auth = { userId };
      next();
    },
    currentOrganizationBySlug: (
      req: { params: { organizationSlug: string }; organization?: unknown },
      _res: unknown,
      next: () => void,
    ) => {
      const slug = req.params.organizationSlug;
      if (!slug) throw new Error("The organization slug must reach nested routes.");
      req.organization = { organizationId: slug === "beta" ? betaId : alphaId, slug };
      next();
    },
    organizationAccess: (
      req: { organization: unknown; organizationAccess?: unknown; params: { organizationSlug: string } },
      _res: unknown,
      next: () => void,
    ) => {
      req.organizationAccess = {
        ...(req.organization as object),
        isSuperAdmin: false,
        membershipRole: req.params.organizationSlug === "member" ? "USER" : "MANAGER",
      };
      next();
    },
  };
});

import organizationRoutes from "../src/routes/orgs/index.js";
import Form from "../src/modules/form/models/index.js";

const app = express();
app.use(express.json());
app.use("/api/orgs", organizationRoutes);
app.use((error: { statusCode?: number; code?: string; message?: string }, _req: unknown, res: express.Response, _next: unknown) => {
  res.status(error.statusCode ?? 500).json({ code: error.code ?? "INTERNAL_ERROR", message: error.message });
});

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120_000);

beforeEach(async () => {
  await Form.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe("organization forms", () => {
  it("creates a blank form in the current organization", async () => {
    const response = await request(app).post("/api/orgs/alpha/forms")
      .send({ name: "  Customer feedback  " }).expect(201);

    expect(response.body.data).toMatchObject({ name: "Customer feedback" });
    const form = await Form.findById(response.body.data.id);
    expect(String(form?.organizationId)).toBe(alphaId);
    expect(String(form?.createdBy)).toBe(userId);
    expect(form?.sections).toEqual([]);
  });

  it("lists only active forms in the current organization with stable pagination", async () => {
    await Form.create({ organizationId: alphaId, createdBy: userId, name: "Alpha" });
    await Form.create({ organizationId: betaId, createdBy: userId, name: "Beta" });
    await Form.create({ organizationId: alphaId, createdBy: userId, name: "Archived", archivedAt: new Date() });

    const response = await request(app).get("/api/orgs/alpha/forms").expect(200);
    expect(response.body.data).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(response.body.data.items.map((form: { name: string }) => form.name)).toEqual(["Alpha"]);
  });

  it("returns the second page without repeating forms", async () => {
    await Form.insertMany(Array.from({ length: 21 }, (_, index) => ({
      organizationId: alphaId,
      createdBy: userId,
      name: `Form ${index + 1}`,
    })));

    const first = await request(app).get("/api/orgs/alpha/forms").expect(200);
    const second = await request(app).get("/api/orgs/alpha/forms?page=2").expect(200);
    expect(first.body.data).toMatchObject({ total: 21, page: 1, pageSize: 20 });
    expect(first.body.data.items).toHaveLength(20);
    expect(second.body.data.items).toHaveLength(1);
    expect(first.body.data.items.map((form: { id: string }) => form.id))
      .not.toContain(second.body.data.items[0].id);
  });

  it("scopes form detail by organization and archived state", async () => {
    const own = await Form.create({ organizationId: alphaId, createdBy: userId, name: "Own" });
    const other = await Form.create({ organizationId: betaId, createdBy: userId, name: "Other" });
    const archived = await Form.create({ organizationId: alphaId, createdBy: userId, name: "Archived", archivedAt: new Date() });

    const response = await request(app).get(`/api/orgs/alpha/forms/${own.id}`).expect(200);
    expect(response.body.data).toMatchObject({ name: "Own", sections: [], displayMode: "SINGLE_PAGE", isClosed: false });
    await request(app).get(`/api/orgs/alpha/forms/${other.id}`).expect(404);
    await request(app).get(`/api/orgs/alpha/forms/${archived.id}`).expect(404);
  });

  it("validates input and checks permission before schemas", async () => {
    await request(app).post("/api/orgs/alpha/forms").send({ name: " " }).expect(400);
    await request(app).post("/api/orgs/alpha/forms").send({ name: "Good", isClosed: false }).expect(400);
    await request(app).get("/api/orgs/alpha/forms?page=0").expect(400);
    await request(app).get("/api/orgs/alpha/forms/not-an-id").expect(400);
    await request(app).post("/api/orgs/member/forms").send({ name: " " }).expect(403);
    await request(app).get("/api/orgs/member/forms/not-an-id").expect(403);
  });
});
