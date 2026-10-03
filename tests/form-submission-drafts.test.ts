import express from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Form from "../src/modules/form/models/index.js";
import FormSubmission from "../src/modules/form-submission/models/index.js";
import draftRoutes from "../src/routes/orgs/[organizationSlug]/forms/[formId]/drafts.js";

const organizationId = "000000000000000000000001";
const firstUserId = "000000000000000000000002";
const secondUserId = "000000000000000000000003";

const app = express();
app.use(express.json());
app.use("/api/orgs/:organizationSlug/forms/:formId/submissions/drafts", (req, _res, next) => {
  Object.assign(req, {
    auth: { userId: req.get("X-Test-User") ?? firstUserId },
    organizationAccess: { organizationId },
  });
  next();
}, draftRoutes);
app.use((error: { statusCode?: number; code?: string; message?: string }, _req: unknown, res: express.Response, _next: unknown) => {
  res.status(error.statusCode ?? 500).json({ code: error.code ?? "INTERNAL_ERROR", message: error.message });
});

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await FormSubmission.init();
}, 120_000);

beforeEach(async () => {
  await FormSubmission.deleteMany({});
  await Form.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

async function createForm() {
  return Form.create({
    organizationId,
    createdBy: firstUserId,
    name: "Feedback",
    type: "AUTHENTICATED",
    sections: [{
      _id: "section-1",
      title: "Details",
      questions: [{
        _id: "question-1",
        name: "feedback",
        title: "Feedback",
        inputType: "string",
        isRequired: true,
      }],
    }],
  });
}

describe("form submission drafts", () => {
  it("saves an incomplete authenticated draft and finalizes the same record once", async () => {
    const form = await createForm();
    const path = `/api/orgs/alpha/forms/${form.id}/submissions/drafts`;
    const created = await request(app).post(path).expect(200);
    const { id } = created.body.data;
    const resumed = await request(app).get(`${path}/${id}`).expect(200);
    expect(resumed.body.data).toMatchObject({ id, formAnswers: {} });

    const partial = await request(app).patch(`${path}/${id}`)
      .send({ formAnswers: { "question-1": "" } }).expect(200);
    expect(partial.body.data.formAnswers).toEqual({});
    await request(app).post(`${path}/${id}/submit`).expect(400);

    const complete = await request(app).patch(`${path}/${id}`)
      .send({ formAnswers: { "question-1": "Looks good" } }).expect(200);
    expect(complete.body.data.formAnswers).toEqual({ "question-1": "Looks good" });
    const started = await FormSubmission.findById(id).lean();
    expect(started?.submittedAt).toBeNull();
    expect(started?.answers[0].value).toBe("Looks good");
    const submitted = await request(app).post(`${path}/${id}/submit`).expect(201);
    expect(submitted.body.data.id).toBe(id);
    expect(submitted.body.data.submittedAt).toBeTruthy();
    const replay = await request(app).post(`${path}/${id}/submit`).expect(200);
    expect(replay.body.data).toEqual(submitted.body.data);
    await request(app).get(`${path}/${id}`).expect(404);

    const record = await FormSubmission.findById(id).lean();
    expect(record?.submittedAt).toBeInstanceOf(Date);
    expect(record?.answers[0].value).toBe("Looks good");
    expect(await FormSubmission.countDocuments({ formId: form.id })).toBe(1);
  });

  it("keeps one active submission per user and form, scoped to its owner", async () => {
    const form = await createForm();
    const path = `/api/orgs/alpha/forms/${form.id}/submissions/drafts`;
    const first = await request(app).post(path).expect(200);
    const id = first.body.data.id;
    const duplicate = await request(app).post(path).expect(200);
    expect(duplicate.body.data.id).toBe(id);
    const current = await request(app).get(`${path}/current`).expect(200);
    expect(current.body.data.id).toBe(id);

    await request(app).get(`${path}/${id}`).set("X-Test-User", secondUserId).expect(404);
    const otherCurrent = await request(app).get(`${path}/current`)
      .set("X-Test-User", secondUserId).expect(200);
    expect(otherCurrent.body.data).toBeNull();

    const saved = await request(app).patch(`${path}/${id}`)
      .send({ formAnswers: { "question-1": "Saved" } }).expect(200);
    expect(saved.body.data.formAnswers).toEqual({ "question-1": "Saved" });
    await request(app).patch(`${path}/${id}`)
      .send({ formAnswers: { "question-1": "Latest" } }).expect(200);
    const unchanged = await request(app).get(`${path}/${id}`).expect(200);
    expect(unchanged.body.data.formAnswers).toEqual({ "question-1": "Latest" });
    await request(app).patch(`${path}/${id}`).set("X-Test-User", secondUserId)
      .send({ formAnswers: { "question-1": "Other" } }).expect(404);
  });

  it("does not expose an authenticated draft through another form", async () => {
    const first = await createForm();
    const second = await createForm();
    const created = await request(app)
      .post(`/api/orgs/alpha/forms/${first.id}/submissions/drafts`).expect(200);
    await request(app)
      .get(`/api/orgs/alpha/forms/${second.id}/submissions/drafts/${created.body.data.id}`).expect(404);
  });

  it("keeps saved file metadata private and uses it when finalizing", async () => {
    const form = await Form.create({
      organizationId,
      createdBy: firstUserId,
      name: "Documents",
      type: "AUTHENTICATED",
      sections: [{
        _id: "section-1",
        title: "Documents",
        questions: [{
          _id: "file-1",
          name: "document",
          title: "Document",
          inputType: "file",
          isRequired: true,
          typeConfig: { uploadCategory: "documents" },
        }],
      }],
    });
    const path = `/api/orgs/alpha/forms/${form.id}/submissions/drafts`;
    const created = await request(app).post(path).expect(200);
    const { id } = created.body.data;
    await FormSubmission.updateOne({ _id: id }, {
      $set: { answers: [{
        sectionId: "section-1",
        sectionTitle: "Documents",
        questionId: "file-1",
        questionName: "document",
        questionTitle: "Document",
        inputType: "file",
        value: [{
          id: "asset-1",
          storageKey: "private-storage-key",
          provider: "cloudinary",
          url: "https://example.com/document.pdf",
          name: "stored.pdf",
          originalName: "document.pdf",
          extension: "pdf",
          mimeType: "application/pdf",
          size: 123,
          createdAt: "2026-01-01T12:00:00.000Z",
        }],
      }] },
    });

    const resumed = await request(app).get(`${path}/${id}`).expect(200);
    expect(resumed.body.data.files).toEqual([{
      questionId: "file-1",
      id: "asset-1",
      name: "document.pdf",
      url: "https://example.com/document.pdf",
      mimeType: "application/pdf",
      size: 123,
    }]);
    expect(JSON.stringify(resumed.body.data)).not.toContain("private-storage-key");

    const submitted = await request(app).post(`${path}/${id}/submit`).expect(201);
    const record = await FormSubmission.findById(submitted.body.data.id).lean();
    expect(record?.answers[0].value).toMatchObject([{ originalName: "document.pdf" }]);
    expect(record?.submittedAt).toBeInstanceOf(Date);
  });
});
