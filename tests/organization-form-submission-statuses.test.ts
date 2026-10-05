import express from "express";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const organizationId = "000000000000000000000001";
const otherOrganizationId = "000000000000000000000002";
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
      req.organization = {
        organizationId: slug === "beta" ? otherOrganizationId : organizationId,
        slug,
      };
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
import FormSubmission from "../src/modules/form-submission/models/index.js";
import FormSubmissionStatus from "../src/modules/form-submission-status/models/index.js";

const app = express();
app.use(express.json());
app.use("/api/orgs", organizationRoutes);
app.use((error: { statusCode?: number; code?: string; message?: string }, _req: unknown, res: express.Response, _next: unknown) => {
  res.status(error.statusCode ?? 500).json({ code: error.code ?? "INTERNAL_ERROR", message: error.message });
});

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
}, 120_000);

beforeEach(async () => {
  await FormSubmission.deleteMany({});
  await FormSubmissionStatus.deleteMany({});
  await Form.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

async function createForm(organizationSlug = "alpha") {
  const response = await request(app).post(`/api/orgs/${organizationSlug}/forms`).send({
    name: "Applications",
    type: "AUTHENTICATED",
    displayMode: "SINGLE_PAGE",
    isClosed: false,
  }).expect(201);
  return response.body.data.id as string;
}

const statusPath = (formId: string, organizationSlug = "alpha") =>
  `/api/orgs/${organizationSlug}/forms/${formId}/submission-statuses`;

describe("form submission statuses", () => {
  it("creates statuses, changes the default, and updates status settings", async () => {
    const formId = await createForm();
    const path = statusPath(formId);
    const initial = await request(app).get(path).expect(200);
    expect(initial.body.data).toHaveLength(5);
    expect(initial.body.data[0]).toMatchObject({
      name: "Pending",
      color: "orange",
      order: 1,
      isDefault: true,
      isSubmissionLocked: false,
      submissionCount: 0,
    });
    expect(initial.body.data.find((status: { name: string }) => status.name === "Accepted")
      .isSubmissionLocked).toBe(true);
    expect(initial.body.data.find((status: { name: string }) => status.name === "Rejected")
      .isSubmissionLocked).toBe(true);
    const pending = initial.body.data[0];
    await request(app).put(`${path}/${pending.id}`).send({ isDefault: false }).expect(409);

    const created = await request(app).post(path).send({
      name: "  Interview  ",
      description: "Candidate interview",
      color: "sky",
      isDefault: true,
      isSubmissionLocked: false,
    }).expect(201);
    expect(created.body.data).toMatchObject({
      name: "Interview",
      description: "Candidate interview",
      color: "sky",
      order: 6,
      isDefault: true,
      isSubmissionLocked: false,
    });

    await request(app).put(`${path}/${created.body.data.id}`).send({
      name: "Final interview",
      description: "",
      color: "purple",
      isSubmissionLocked: true,
    }).expect(200).then(({ body }) => {
      expect(body.data).toMatchObject({
        name: "Final interview",
        description: "",
        color: "purple",
        isDefault: true,
        isSubmissionLocked: true,
      });
    });

    const statuses = await FormSubmissionStatus.find({ formId }).lean();
    expect(statuses.filter((status) => status.isDefault)).toHaveLength(1);
    expect(statuses.find((status) => status.name === "Pending")?.isDefault).toBe(false);
  });

  it("reorders all statuses and rejects incomplete or duplicate orders", async () => {
    const formId = await createForm();
    const path = statusPath(formId);
    const statuses = (await request(app).get(path).expect(200)).body.data as Array<{ id: string; name: string }>;
    const reorderedIds = [...statuses].reverse().map((status) => status.id);

    await request(app).put(`${path}/reorder`).send({ statusIds: reorderedIds.slice(1) }).expect(400);
    await request(app).put(`${path}/reorder`).send({ statusIds: [reorderedIds[0], ...reorderedIds.slice(1, -1), reorderedIds[0]] }).expect(400);
    const reordered = await request(app).put(`${path}/reorder`).send({ statusIds: reorderedIds }).expect(200);

    expect(reordered.body.data.map((status: { id: string; order: number }) => [status.id, status.order]))
      .toEqual(reorderedIds.map((id, index) => [id, index + 1]));
    const fromDatabase = await FormSubmissionStatus.find({ formId }).sort({ order: 1 }).lean();
    expect(fromDatabase.map((status) => String(status._id))).toEqual(reorderedIds);
  });

  it("protects the default and used statuses, then compacts order after deletion", async () => {
    const formId = await createForm();
    const path = statusPath(formId);
    const statuses = (await request(app).get(path).expect(200)).body.data as Array<{
      id: string;
      name: string;
      order: number;
    }>;
    const pending = statuses[0];
    const inReview = statuses.find((status) => status.name === "In review")!;
    const onHold = statuses.find((status) => status.name === "On Hold")!;

    await request(app).delete(`${path}/${pending.id}`).expect(409);
    await request(app).delete(`${path}/${inReview.id}`).expect(200);
    await request(app).post(path).send({ name: "Used", color: "green" }).expect(201);
    const used = (await FormSubmissionStatus.findOne({ formId, name: "Used" }).lean())!;
    await FormSubmission.create({
      organizationId,
      formId,
      submissionStatusId: used._id,
      answers: {},
      submittedAt: new Date(),
    });
    await request(app).delete(`${path}/${used._id}`).expect(409);
    await request(app).delete(`${path}/${onHold.id}`).expect(200);

    const afterDelete = await request(app).get(path).expect(200);
    expect(afterDelete.body.data.map((status: { order: number }) => status.order))
      .toEqual([1, 2, 3, 4]);
  });

  it("updates a submission only to a status belonging to its form and organization", async () => {
    const formId = await createForm();
    const otherFormId = await createForm("beta");
    const statuses = (await request(app).get(statusPath(formId)).expect(200)).body.data;
    const otherStatus = (await request(app).get(statusPath(otherFormId, "beta")).expect(200)).body.data[0];
    const submission = await FormSubmission.create({
      organizationId,
      formId,
      submissionStatusId: statuses[0].id,
      submittedAt: new Date(),
      answers: {},
    });
    const path = `/api/orgs/alpha/forms/${formId}/submissions/${submission.id}/status`;

    await request(app).put(path).send({ submissionStatusId: otherStatus.id }).expect(404);
    const updated = await request(app).put(path).send({ submissionStatusId: statuses[1].id }).expect(200);
    expect(updated.body.data).toMatchObject({
      id: submission.id,
      submissionStatusId: statuses[1].id,
    });
    const filtered = await request(app).get(`/api/orgs/alpha/forms/${formId}/submissions`)
      .query({ submissionStatusId: statuses[1].id }).expect(200);
    expect(filtered.body.data.items).toHaveLength(1);
    expect(filtered.body.data.items[0]).toMatchObject({
      id: submission.id,
      submissionStatusId: statuses[1].id,
    });
    await request(app).put(`/api/orgs/member/forms/${formId}/submissions/${submission.id}/status`)
      .send({ submissionStatusId: statuses[0].id }).expect(403);
  });

  it("validates status input and form ownership", async () => {
    const formId = await createForm();
    const path = statusPath(formId);
    await request(app).post(path).send({ name: "Invalid color", color: "cyan" }).expect(400);
    await request(app).post(path).send({ name: "   ", color: "blue" }).expect(400);
    await request(app).get(statusPath(formId, "beta")).expect(404);
  });
});
