import express from "express";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
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
        membershipRole: req.params.organizationSlug === "member" ? "USER" : "MANAGER",
      };
      next();
    },
  };
});

import organizationRoutes from "../src/routes/orgs/index.js";
import Form from "../src/modules/form/models/index.js";
import FormSubmission from "../src/modules/form-submission/models/index.js";
import FormSubmissionStatus from "../src/modules/form-submission-status/models/index.js";
import User from "../src/modules/user/models/index.js";

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
    res
      .status(error.statusCode ?? 500)
      .json({ code: error.code ?? "INTERNAL_ERROR", message: error.message });
  },
);

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
}, 120_000);

beforeEach(async () => {
  await FormSubmission.deleteMany({});
  await FormSubmissionStatus.deleteMany({});
  await Form.deleteMany({});
  await User.deleteMany({});
});

async function createDefaultStatus(formId: string, organizationId = alphaId) {
  const status = await FormSubmissionStatus.create({
    organizationId,
    formId,
    name: "Pending",
    color: "orange",
    order: 1,
    isDefault: true,
  });
  return status._id;
}

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe("organization forms", () => {
  it("creates a blank form in the current organization", async () => {
    const response = await request(app)
      .post("/api/orgs/alpha/forms")
      .send({
        name: "  Customer feedback  ",
        type: "PUBLIC",
        displayMode: "SINGLE_PAGE",
        isClosed: false,
      })
      .expect(201);

    expect(response.body.data).toMatchObject({ name: "Customer feedback" });
    const form = await Form.findById(response.body.data.id);
    expect(String(form?.organizationId)).toBe(alphaId);
    expect(String(form?.createdBy)).toBe(userId);
    expect(form?.sections).toEqual([]);
    const statuses = await FormSubmissionStatus.find({ formId: form?._id })
      .sort({ order: 1 })
      .lean();
    expect(statuses).toMatchObject([
      { name: "Pending", color: "orange", order: 1, isDefault: true, isSubmissionLocked: false },
      { name: "In review", color: "indigo", order: 2, isDefault: false, isSubmissionLocked: false },
      { name: "On Hold", color: "amber", order: 3, isDefault: false, isSubmissionLocked: false },
      { name: "Accepted", color: "green", order: 4, isDefault: false, isSubmissionLocked: true },
      { name: "Rejected", color: "red", order: 5, isDefault: false, isSubmissionLocked: true },
    ]);
  });

  it("lists only active forms in the current organization with stable pagination", async () => {
    await Form.create({ organizationId: alphaId, createdBy: userId, name: "Alpha" });
    await Form.create({ organizationId: betaId, createdBy: userId, name: "Beta" });
    await Form.create({
      organizationId: alphaId,
      createdBy: userId,
      name: "Archived",
      archivedAt: new Date(),
    });

    const response = await request(app).get("/api/orgs/alpha/forms").expect(200);
    expect(response.body.data).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(response.body.data.items.map((form: { name: string }) => form.name)).toEqual(["Alpha"]);
  });

  it("returns the second page without repeating forms", async () => {
    await Form.insertMany(
      Array.from({ length: 21 }, (_, index) => ({
        organizationId: alphaId,
        createdBy: userId,
        name: `Form ${index + 1}`,
      })),
    );

    const first = await request(app).get("/api/orgs/alpha/forms").expect(200);
    const second = await request(app).get("/api/orgs/alpha/forms?page=2").expect(200);
    expect(first.body.data).toMatchObject({ total: 21, page: 1, pageSize: 20 });
    expect(first.body.data.items).toHaveLength(20);
    expect(second.body.data.items).toHaveLength(1);
    expect(first.body.data.items.map((form: { id: string }) => form.id)).not.toContain(
      second.body.data.items[0].id,
    );
  });

  it("scopes form detail by organization and archived state", async () => {
    const own = await Form.create({ organizationId: alphaId, createdBy: userId, name: "Own" });
    const other = await Form.create({ organizationId: betaId, createdBy: userId, name: "Other" });
    const archived = await Form.create({
      organizationId: alphaId,
      createdBy: userId,
      name: "Archived",
      archivedAt: new Date(),
    });

    const response = await request(app).get(`/api/orgs/alpha/forms/${own.id}`).expect(200);
    expect(response.body.data).toMatchObject({
      name: "Own",
      sections: [],
      displayMode: "SINGLE_PAGE",
      isClosed: false,
    });
    await request(app).get(`/api/orgs/alpha/forms/${other.id}`).expect(404);
    await request(app).get(`/api/orgs/alpha/forms/${archived.id}`).expect(404);
  });

  it("validates input and checks permission before schemas", async () => {
    await request(app).post("/api/orgs/alpha/forms").send({ name: " " }).expect(400);
    await request(app)
      .post("/api/orgs/alpha/forms")
      .send({ name: "Good", isClosed: false })
      .expect(400);
    await request(app).get("/api/orgs/alpha/forms?page=0").expect(400);
    await request(app).get("/api/orgs/alpha/forms/not-an-id").expect(400);
    await request(app).post("/api/orgs/member/forms").send({ name: " " }).expect(403);
    await request(app).get("/api/orgs/member/forms/not-an-id").expect(403);
  });

  it("lists submissions only for an accessible active form", async () => {
    const own = await Form.create({ organizationId: alphaId, createdBy: userId, name: "Own" });
    const other = await Form.create({ organizationId: betaId, createdBy: userId, name: "Other" });
    const archived = await Form.create({
      organizationId: alphaId,
      createdBy: userId,
      name: "Archived",
      archivedAt: new Date(),
    });
    const submissionStatusId = await createDefaultStatus(own.id);
    const submission = await FormSubmission.create({
      organizationId: alphaId,
      formId: own.id,
      submissionStatusId,
      submittedAt: new Date(),
      answers: {},
    });
    await FormSubmission.create({
      organizationId: alphaId,
      formId: own.id,
      submissionStatusId,
      submittedAt: null,
      answers: {},
    });

    const response = await request(app)
      .get(`/api/orgs/alpha/forms/${own.id}/submissions`)
      .expect(200);
    expect(response.body.data).toMatchObject({
      items: [
        {
          id: String(submission._id),
          submittedAt: submission.submittedAt?.toISOString(),
          submittedBy: { kind: "anonymous" },
          answers: {},
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await request(app).get(`/api/orgs/alpha/forms/${other.id}/submissions`).expect(404);
    await request(app).get(`/api/orgs/alpha/forms/${archived.id}/submissions`).expect(404);
    await request(app).get(`/api/orgs/member/forms/${own.id}/submissions`).expect(403);
    await request(app).get("/api/orgs/alpha/forms/not-an-id/submissions").expect(400);
  });

  it("paginates submissions in stable newest-first order", async () => {
    const form = await Form.create({
      organizationId: alphaId,
      createdBy: userId,
      name: "Feedback",
    });
    const submissionStatusId = await createDefaultStatus(form.id);
    const submittedAt = new Date("2026-01-01T12:00:00.000Z");
    await FormSubmission.insertMany(
      Array.from({ length: 22 }, () => ({
        organizationId: alphaId,
        formId: form.id,
        submissionStatusId,
        answers: {},
        createdAt: submittedAt,
        submittedAt,
      })),
    );

    const first = await request(app)
      .get(`/api/orgs/alpha/forms/${form.id}/submissions`)
      .expect(200);
    expect(first.body.data).toMatchObject({ total: 22, page: 1, pageSize: 20 });
    expect(first.body.data.items).toHaveLength(20);
    const second = await request(app)
      .get(`/api/orgs/alpha/forms/${form.id}/submissions`)
      .query({ page: 2 })
      .expect(200);
    expect(second.body.data).toMatchObject({ total: 22, page: 2, pageSize: 20 });
    expect(second.body.data.items).toHaveLength(2);
    const beyondLast = await request(app)
      .get(`/api/orgs/alpha/forms/${form.id}/submissions`)
      .query({ page: 3 })
      .expect(200);
    expect(beyondLast.body.data).toMatchObject({ items: [], total: 22, page: 3, pageSize: 20 });
    expect(
      new Set(
        [...first.body.data.items, ...second.body.data.items].map(
          (item: { id: string }) => item.id,
        ),
      ).size,
    ).toBe(22);
    await request(app)
      .get(`/api/orgs/alpha/forms/${form.id}/submissions`)
      .query({ page: 0 })
      .expect(400);
  });

  it("filters completed submissions by stored user keywords and submitted date", async () => {
    const form = await Form.create({
      organizationId: alphaId,
      createdBy: userId,
      name: "Applications",
    });
    const submissionStatusId = await createDefaultStatus(form.id);
    const first = await FormSubmission.create({
      organizationId: alphaId,
      formId: form.id,
      submissionStatusId,
      submittedAt: new Date("2026-01-02T12:00:00.000Z"),
      searchKeywords: "Amina Karim amina@gmail.com +212 600 000 000",
      answers: {},
    });
    await FormSubmission.create({
      organizationId: alphaId,
      formId: form.id,
      submissionStatusId,
      submittedAt: new Date("2026-01-01T12:00:00.000Z"),
      searchKeywords: "Omar Idrissi omar@gmail.com",
      answers: {},
    });

    const response = await request(app)
      .get(`/api/orgs/alpha/forms/${form.id}/submissions`)
      .query({
        search: "amina@gmail.com",
        dateFrom: "2026-01-02T00:00:00.000Z",
        dateBefore: "2026-01-03T00:00:00.000Z",
      })
      .expect(200);
    expect(response.body.data).toMatchObject({ total: 1, page: 1 });
    expect(response.body.data.items.map((item: { id: string }) => item.id)).toEqual([first.id]);

    const publicForm = await Form.create({
      organizationId: alphaId,
      createdBy: userId,
      name: "Public",
      type: "PUBLIC",
    });
    await request(app)
      .get(`/api/orgs/alpha/forms/${publicForm.id}/submissions`)
      .query({ search: "amina" })
      .expect(400);
  });

  it("filters started and submitted records and sorts their event dates", async () => {
    const form = await Form.create({
      organizationId: alphaId,
      createdBy: userId,
      name: "Applications",
    });
    const submissionStatusId = await createDefaultStatus(form.id);
    const submitted = await FormSubmission.create({
      organizationId: alphaId,
      formId: form.id,
      submissionStatusId,
      submittedBy: new mongoose.Types.ObjectId(),
      createdAt: new Date("2026-01-01T12:00:00.000Z"),
      submittedAt: new Date("2026-01-03T12:00:00.000Z"),
      answers: {},
    });
    const started = await FormSubmission.create({
      organizationId: alphaId,
      formId: form.id,
      submissionStatusId,
      submittedBy: new mongoose.Types.ObjectId(),
      createdAt: new Date("2026-01-02T12:00:00.000Z"),
      submittedAt: null,
      answers: {},
    });
    const url = `/api/orgs/alpha/forms/${form.id}/submissions`;

    const newest = await request(app).get(url).query({ status: "all" }).expect(200);
    expect(newest.body.data.items.map((item: { id: string }) => item.id)).toEqual([
      submitted.id,
      started.id,
    ]);
    const oldest = await request(app).get(url).query({ status: "all", sort: "oldest" }).expect(200);
    expect(oldest.body.data.items.map((item: { id: string }) => item.id)).toEqual([
      started.id,
      submitted.id,
    ]);
    const drafts = await request(app)
      .get(url)
      .query({
        status: "started",
        dateFrom: "2026-01-02T00:00:00.000Z",
        dateBefore: "2026-01-03T00:00:00.000Z",
      })
      .expect(200);
    expect(drafts.body.data).toMatchObject({
      total: 1,
      items: [{ id: started.id, submittedAt: null }],
    });
    expect(drafts.body.data.items[0].startedAt).toBe("2026-01-02T12:00:00.000Z");

    const publicForm = await Form.create({
      organizationId: alphaId,
      createdBy: userId,
      name: "Public",
      type: "PUBLIC",
    });
    await request(app)
      .get(`/api/orgs/alpha/forms/${publicForm.id}/submissions`)
      .query({ status: "started" })
      .expect(400);
  });

  it("returns answers and limited user data without internal fields", async () => {
    const form = await Form.create({
      organizationId: alphaId,
      createdBy: userId,
      name: "Feedback",
    });
    const submissionStatusId = await createDefaultStatus(form.id);
    const user = await User.create({
      email: "reader@example.com",
      authUserId: "auth-reader",
      firstName: "Ada",
      lastName: "Lovelace",
      profilePic: "https://example.com/ada.jpg",
    });
    await FormSubmission.create({
      organizationId: alphaId,
      formId: form.id,
      submissionStatusId,
      submittedBy: user.id,
      submittedAt: new Date(),
      answers: {
        "file-1": [
          {
            id: "asset-id",
            storageKey: "private-storage-key",
            provider: "cloudinary",
            url: "https://example.com/file.pdf",
            name: "stored.pdf",
            originalName: "answer.pdf",
            extension: "pdf",
            mimeType: "application/pdf",
            size: 123,
            createdAt: "2026-01-01T12:00:00.000Z",
          },
        ],
      },
    });

    const response = await request(app)
      .get(`/api/orgs/alpha/forms/${form.id}/submissions`)
      .expect(200);
    expect(response.body.data.items[0]).toMatchObject({
      submittedBy: {
        kind: "user",
        name: "Ada Lovelace",
        email: "reader@example.com",
        profilePic: "https://example.com/ada.jpg",
      },
      answers: {
        "file-1": [{ name: "answer.pdf", url: "https://example.com/file.pdf", size: 123 }],
      },
    });
    expect(JSON.stringify(response.body.data)).not.toContain("private-key");
    expect(JSON.stringify(response.body.data)).not.toContain("private-storage-key");
    expect(JSON.stringify(response.body.data)).not.toContain("auth-reader");
  });
});
