import express from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const organizationIds = {
  alpha: "000000000000000000000001",
  beta: "000000000000000000000002",
};

vi.mock("../src/middlewares/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/middlewares/index.js")>();
  return {
    ...actual,
    authenticate: (req: { auth?: unknown }, _res: unknown, next: () => void) => {
      req.auth = { userId: "000000000000000000000003" };
      next();
    },
    currentOrganizationBySlug: (
      req: { params: { organizationSlug: string }; organization?: unknown },
      _res: unknown,
      next: () => void,
    ) => {
      const slug = req.params.organizationSlug;
      if (!slug) throw new Error("The organization slug must reach nested routes.");
      req.organization = {
        organizationId: organizationIds[slug === "beta" ? "beta" : "alpha"],
        slug,
      };
      next();
    },
    organizationAccess: (
      req: {
        organization: unknown;
        organizationAccess?: unknown;
        params: { organizationSlug: string };
      },
      _res: unknown,
      next: () => void,
    ) => {
      req.organizationAccess = {
        ...(req.organization as object),
        isSuperAdmin: false,
        membershipRole: req.params.organizationSlug === "manager" ? "MANAGER" : "ADMIN",
      };
      next();
    },
  };
});

import organizationRoutes from "../src/routes/orgs/index.js";
import Invitation from "../src/modules/invitation/models/index.js";
import Organization from "../src/modules/organization/models/index.js";

const app = express();
app.use(express.json());
app.use("/api/orgs", organizationRoutes);
app.use(
  (
    error: { statusCode?: number; code?: string; message?: string },
    _req: unknown,
    res: express.Response,
    _next: unknown,
  ) => {
    res.status(error.statusCode ?? 500).json({
      code: error.code ?? "INTERNAL_ERROR",
      message: error.message,
    });
  },
);

let mongo: MongoMemoryServer;

async function createInvitation(input: {
  email: string;
  organizationId?: string;
  expiresAt?: Date;
  status?: "PENDING" | "CANCELLED";
}) {
  return Invitation.create({
    organizationId: input.organizationId ?? organizationIds.alpha,
    invitedBy: "000000000000000000000003",
    email: input.email,
    role: "MANAGER",
    tokenHash: `${input.email}-token`,
    expiresAt: input.expiresAt ?? new Date(Date.now() + 86_400_000),
    status: input.status ?? "PENDING",
  });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120_000);

beforeEach(async () => {
  await Invitation.deleteMany({});
  await Organization.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe("organization invitation management", () => {
  it("lists this organization's active and expired invitations without exposing tokens", async () => {
    await createInvitation({ email: "active@example.com" });
    await createInvitation({
      email: "expired@example.com",
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    await createInvitation({ email: "canceled@example.com", status: "CANCELLED" });
    await createInvitation({ email: "other@example.com", organizationId: organizationIds.beta });

    const response = await request(app).get("/api/orgs/alpha/invitations").expect(200);
    const byEmail = new Map(
      response.body.data.map((item: { email: string }) => [item.email, item]),
    );

    expect([...byEmail.keys()].sort()).toEqual(["active@example.com", "expired@example.com"]);
    expect(byEmail.get("active@example.com")).toMatchObject({ status: "PENDING", role: "MANAGER" });
    expect(byEmail.get("expired@example.com")).toMatchObject({ status: "EXPIRED" });
    expect(response.body.data[0]).not.toHaveProperty("tokenHash");
  });

  it("cancels only an active invitation in the current organization", async () => {
    const own = await createInvitation({ email: "own@example.com" });
    const other = await createInvitation({
      email: "other@example.com",
      organizationId: organizationIds.beta,
    });
    const expired = await createInvitation({
      email: "expired@example.com",
      expiresAt: new Date(Date.now() - 86_400_000),
    });

    await request(app).delete(`/api/orgs/alpha/invitations/${other.id}`).expect(404);
    await request(app).delete(`/api/orgs/alpha/invitations/${expired.id}`).expect(404);
    await request(app).delete(`/api/orgs/alpha/invitations/${own.id}`).expect(200);

    expect((await Invitation.findById(own.id))?.status).toBe("CANCELLED");
    expect((await Invitation.findById(other.id))?.status).toBe("PENDING");
    expect(await Invitation.findOne({ _id: own.id, status: "PENDING" })).toBeNull();
  });

  it("rejects managers", async () => {
    await request(app).get("/api/orgs/manager/invitations").expect(403);
  });
});

describe("organization request validation", () => {
  it("keeps null primaryColor as the default blue on updates", async () => {
    await Organization.create({ _id: organizationIds.alpha, name: "Alpha", slug: "alpha" });

    const response = await request(app)
      .put("/api/orgs/alpha")
      .send({ primaryColor: null })
      .expect(200);

    expect(response.body.data.primaryColor).toBe("blue");
  });

  it("keeps body, query, and path errors as bad requests", async () => {
    const invalidSlug = await request(app)
      .post("/api/orgs")
      .send({ name: "Acme", slug: "bad_slug" })
      .expect(400);
    expect(invalidSlug.body).toMatchObject({
      code: "BAD_REQUEST",
      message: "slug must use lowercase letters, numbers, and single hyphens only.",
    });

    const emptyUpdate = await request(app).put("/api/orgs/alpha").send({}).expect(400);
    expect(emptyUpdate.body.message).toBe(
      "Only name, logo, primaryColor, slogan, and shortDescription can be updated.",
    );

    const missingEmail = await request(app).get("/api/orgs/alpha/members/lookup").expect(400);
    expect(missingEmail.body.message).toBe("A valid email is required.");

    const invalidMemberId = await request(app)
      .put("/api/orgs/alpha/members/not-an-id")
      .send({ role: "ADMIN" })
      .expect(400);
    expect(invalidMemberId.body.message).toBe("A valid membership ID is required.");

    const invalidInvitationId = await request(app)
      .delete("/api/orgs/alpha/invitations/not-an-id")
      .expect(400);
    expect(invalidInvitationId.body.message).toBe("A valid invitation ID is required.");
  });

  it("checks permissions before request schemas", async () => {
    await request(app).delete("/api/orgs/manager/invitations/not-an-id").expect(403);
  });
});
