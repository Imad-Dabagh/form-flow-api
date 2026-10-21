import express from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import currentOrganization from "../src/middlewares/current-organization-by-slug.js";
import organizationAccess from "../src/middlewares/organization-access.js";
import resolveUploadTenant from "../src/middlewares/resolve-upload-tenant.js";
import authorize from "../src/middlewares/authorize.js";
import Organization from "../src/modules/organization/models/index.js";
import Membership from "../src/modules/membership/models/index.js";
import { AppError } from "../src/utils/errors.js";

const organizationId = "000000000000000000000001";
const userId = "000000000000000000000002";
const app = express();
app.use((req, _res, next) => {
  req.auth = {
    userId,
    authUserId: "auth-user",
    email: "member@example.com",
    isEmailVerified: true,
    isSuperAdmin: req.get("X-Test-Admin") === "true",
  };
  next();
});
app.get(
  "/orgs/:organizationSlug",
  currentOrganization,
  organizationAccess,
  authorize("form.read"),
  (_req, res) => res.sendStatus(204),
);
app.post("/upload", resolveUploadTenant, (req, res) => res.json({ tenant: req.uploadTenantId }));
app.use(
  (error: AppError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.statusCode ?? 500).json({ code: error.code });
  },
);

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120_000);
beforeEach(async () => {
  await Organization.deleteMany({});
  await Membership.deleteMany({});
  await Organization.create({ _id: organizationId, name: "Alpha", slug: "alpha" });
  await Membership.create({ organizationId, userId, role: "ADMIN" });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe("organization suspension boundaries", () => {
  it("allows active member access and rejects disabled access", async () => {
    await request(app).get("/orgs/alpha").expect(204);
    await Organization.updateOne({ _id: organizationId }, { isDisabled: true });
    await request(app).get("/orgs/alpha").expect(404);
    await request(app).get("/orgs/alpha").set("X-Test-Admin", "true").expect(204);
  });

  it("blocks organization uploads except for platform administrators", async () => {
    await Organization.updateOne({ _id: organizationId }, { isDisabled: true });
    await request(app).post("/upload").set("x-organization-slug", "alpha").expect(404);
    const response = await request(app)
      .post("/upload")
      .set("x-organization-slug", "alpha")
      .set("X-Test-Admin", "true")
      .expect(200);
    expect(response.body.tenant).toBe(`organization-${organizationId}`);
    await request(app).post("/upload").expect(200);
  });

  it("keeps archived organizations unavailable even to platform administrators", async () => {
    await Organization.updateOne({ _id: organizationId }, { archivedAt: new Date() });
    await request(app).get("/orgs/alpha").set("X-Test-Admin", "true").expect(404);
    await request(app)
      .post("/upload")
      .set("x-organization-slug", "alpha")
      .set("X-Test-Admin", "true")
      .expect(404);
  });
});
