import express from "express";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Form from "../src/modules/form/models/index.js";
import FormSubmission from "../src/modules/form-submission/models/index.js";
import FormSubmissionStatus from "../src/modules/form-submission-status/models/index.js";
import Membership from "../src/modules/membership/models/index.js";
import User from "../src/modules/user/models/index.js";
import meRoutes from "../src/routes/me/index.js";
import { storageProvider } from "../src/services/storage/index.js";

const organizationId = "000000000000000000000001";
const userId = "000000000000000000000002";
const otherUserId = "000000000000000000000003";

const app = express();
app.use(express.json());
app.use("/api/me", (req, _res, next) => {
  const currentUserId = req.get("X-Test-User");
  if (currentUserId) req.auth = { userId: currentUserId } as typeof req.auth;
  next();
}, meRoutes);
app.use((error: { statusCode?: number; code?: string }, _req: unknown, res: express.Response, _next: unknown) => {
  res.status(error.statusCode ?? 500).json({ code: error.code ?? "INTERNAL_ERROR" });
});

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([FormSubmission.init(), Membership.init()]);
}, 120_000);

beforeEach(async () => {
  await Promise.all([
    Form.deleteMany({}),
    FormSubmission.deleteMany({}),
    FormSubmissionStatus.deleteMany({}),
    Membership.deleteMany({}),
    User.deleteMany({}),
  ]);
  await User.create([
    { _id: userId, authUserId: "auth-user", email: "member@example.com", firstName: "Amina", lastName: "Karim", phone: "+212 600 000 000" },
    { _id: otherUserId, authUserId: "auth-other", email: "other@example.com", firstName: "Other" },
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

afterEach(() => vi.restoreAllMocks());

async function createForm(overrides: Record<string, unknown> = {}) {
  const form = await Form.create({
    organizationId,
    createdBy: userId,
    name: "Feedback",
    type: "AUTHENTICATED",
    sections: [{
      _id: "section-1",
      title: "Details",
      questions: [{
        _id: "question-1",
        title: "Feedback",
        inputType: "string",
        isRequired: true,
      }],
    }],
    ...overrides,
  });
  await FormSubmissionStatus.create({
    organizationId,
    formId: form.id,
    name: "Pending",
    color: "orange",
    order: 1,
    isDefault: true,
  });
  return form;
}

async function getDefaultStatusId(formId: string) {
  const status = await FormSubmissionStatus.findOne({ formId, isDefault: true }).lean();
  if (!status) throw new Error("Test form has no default submission status.");
  return status._id;
}

describe("current user's form submission", () => {
  it("creates one unfinished submission and enrolls its owner when opening an authenticated form", async () => {
    const form = await createForm();
    const path = `/api/me/forms/${form.id}/submission`;
    const first = await request(app).get(path).set("X-Test-User", userId).expect(200);
    const second = await request(app).get(path).set("X-Test-User", userId).expect(200);

    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body.data).toMatchObject({
      form: { id: form.id, name: "Feedback" },
      submission: { submittedAt: null, answers: {} },
      submissionStatuses: [{ name: "Pending", isDefault: true, isSubmissionLocked: false }],
    });
    expect(first.body.data.submission.submissionStatusId)
      .toBe(first.body.data.submissionStatuses[0].id);
    expect(second.body.data.submission.id).toBe(first.body.data.submission.id);
    expect(await FormSubmission.countDocuments({ formId: form.id, submittedBy: userId })).toBe(1);
    expect((await FormSubmission.findOne({ formId: form.id, submittedBy: userId }).lean())?.searchKeywords)
      .toBe("Amina Karim member@example.com +212 600 000 000");
    expect(await Membership.findOne({ userId, organizationId }).lean()).toMatchObject({ role: "USER" });
  });

  it("returns only the questions needed to fill the form", async () => {
    const form = await createForm({ sections: [{
      _id: "section-1", title: "Quiz", questions: [{
        _id: "question-1", title: "Choose one",
        inputType: "radio", options: [{ label: "A", value: "a", isCorrectAnswer: true }],
      }],
    }] });
    const response = await request(app).get(`/api/me/forms/${form.id}/submission`)
      .set("X-Test-User", userId).expect(200);
    expect(response.body.data.form).toMatchObject({
      name: "Feedback",
      sections: [{ questions: [{ _id: "question-1", title: "Choose one", options: [{ label: "A", value: "a" }] }] }],
    });
    expect(JSON.stringify(response.body.data.form)).not.toContain("isCorrectAnswer");
  });

  it("returns saved answers to their owner without private file storage fields", async () => {
    const form = await createForm();
    const submission = await FormSubmission.create({
      organizationId,
      formId: form.id,
      submissionStatusId: await getDefaultStatusId(form.id),
      submittedBy: userId,
      answers: {
        "question-1": "Saved",
        "file-1": [{
            id: "asset-1", originalName: "letter.pdf", url: "https://example.com/letter.pdf",
            mimeType: "application/pdf", size: 42, storageKey: "private-key",
        }],
      },
    });

    const result = await request(app).get(`/api/me/forms/${form.id}/submission`)
      .set("X-Test-User", userId).expect(200);
    expect(result.body.data.submission).toMatchObject({
      id: submission.id,
      answers: {
        "question-1": "Saved",
        "file-1": [{ id: "asset-1", name: "letter.pdf", url: "https://example.com/letter.pdf" }],
      },
    });
    expect(JSON.stringify(result.body.data)).not.toContain("private-key");
    const other = await request(app).get(`/api/me/forms/${form.id}/submission`)
      .set("X-Test-User", otherUserId).expect(200);
    expect(other.body.data.submission.answers).toEqual({});
  });

  it("saves incomplete answers, validates on submit, and updates a completed unlocked submission", async () => {
    const form = await createForm();
    const path = `/api/me/forms/${form.id}/submission`;
    const opened = await request(app).get(path).set("X-Test-User", userId).expect(200);
    const id = opened.body.data.submission.id;

    await request(app).put(path).set("X-Test-User", userId)
      .send({ formAnswers: { "question-1": "" } }).expect(200);
    await request(app).put(`${path}/submit`).set("X-Test-User", userId).expect(400);
    const saved = await request(app).put(path).set("X-Test-User", userId)
      .send({ formAnswers: { "question-1": "My answer" } }).expect(200);
    expect(saved.body.data.answers).toEqual({ "question-1": "My answer" });
    expect((await request(app).get(path).set("X-Test-User", userId)).body.data.submission.answers)
      .toEqual({ "question-1": "My answer" });

    const completed = await request(app).put(`${path}/submit`).set("X-Test-User", userId).expect(200);
    expect(completed.body.data).toMatchObject({ id, answers: { "question-1": "My answer" } });
    expect(completed.body.data.submittedAt).toBeTruthy();
    const repeated = await request(app).put(`${path}/submit`).set("X-Test-User", userId).expect(200);
    expect(repeated.body.data.submittedAt).toBe(completed.body.data.submittedAt);
    const updated = await request(app).put(path).set("X-Test-User", userId)
      .send({ formAnswers: { "question-1": "Changed" } }).expect(200);
    expect(updated.body.data).toMatchObject({
      id,
      submittedAt: completed.body.data.submittedAt,
      answers: { "question-1": "Changed" },
    });
    expect(await FormSubmission.countDocuments({ formId: form.id })).toBe(1);
  });

  it("blocks answer updates when the current status is locked or the form is closed", async () => {
    const form = await createForm();
    const path = `/api/me/forms/${form.id}/submission`;
    const opened = await request(app).get(path).set("X-Test-User", userId).expect(200);
    await request(app).put(path).set("X-Test-User", userId)
      .send({ formAnswers: { "question-1": "Submitted" } }).expect(200);
    await request(app).put(`${path}/submit`).set("X-Test-User", userId).expect(200);

    const statusId = opened.body.data.submission.submissionStatusId;
    await FormSubmissionStatus.updateOne({ _id: statusId }, { isSubmissionLocked: true });
    await request(app).put(path).set("X-Test-User", userId)
      .send({ formAnswers: { "question-1": "Blocked by status" } }).expect(409);

    await FormSubmissionStatus.updateOne({ _id: statusId }, { isSubmissionLocked: false });
    await Form.updateOne({ _id: form._id }, { isClosed: true });
    const closed = await request(app).put(path).set("X-Test-User", userId)
      .send({ formAnswers: { "question-1": "Blocked by form" } }).expect(409);
    expect(closed.body.code).toBe("FORM_CLOSED");
  });

  it("only lets the owner save and rejects answers outside the form", async () => {
    const form = await createForm();
    const path = `/api/me/forms/${form.id}/submission`;
    await request(app).get(path).set("X-Test-User", userId).expect(200);
    await request(app).put(path).set("X-Test-User", otherUserId)
      .send({ formAnswers: { "question-1": "Other" } }).expect(404);
    await request(app).put(`${path}/submit`).set("X-Test-User", otherUserId).expect(404);
    await request(app).put(path).set("X-Test-User", userId)
      .send({ formAnswers: { unknown: "No" } }).expect(400);
    await request(app).put(path).set("X-Test-User", userId)
      .send({ formAnswers: { "question-1": { unsafe: true } } }).expect(400);
  });

  it("stores uploaded files as answers and removes them without exposing storage metadata", async () => {
    const form = await createForm({ sections: [{
      _id: "section-1", title: "Documents", questions: [{
        _id: "file-1", title: "Document", inputType: "file",
        isRequired: true, typeConfig: { uploadCategory: "documents" },
      }],
    }] });
    const path = `/api/me/forms/${form.id}/submission`;
    await request(app).get(path).set("X-Test-User", userId).expect(200);
    const uploadedFile = {
      id: "asset-1", storageKey: "private-key", provider: "cloudinary",
      url: "https://example.com/document.pdf", name: "stored.pdf", originalName: "document.pdf",
      extension: "pdf", mimeType: "application/pdf", size: 24,
      createdAt: "2026-01-01T12:00:00.000Z",
    };
    vi.spyOn(storageProvider, "upload").mockResolvedValue(uploadedFile);
    const removeFromStorage = vi.spyOn(storageProvider, "delete").mockResolvedValue();

    const uploaded = await request(app).post(`${path}/files/file-1`).set("X-Test-User", userId)
      .attach("file", Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"), "document.pdf").expect(201);
    expect(uploaded.body.data.answers["file-1"]).toMatchObject([{
      id: "asset-1", name: "document.pdf", url: uploadedFile.url,
    }]);
    expect(JSON.stringify(uploaded.body.data)).not.toContain("private-key");
    await request(app).put(path).set("X-Test-User", userId)
      .send({ formAnswers: {} }).expect(200);
    await request(app).delete(`${path}/files/asset-1`).set("X-Test-User", otherUserId).expect(404);
    const removed = await request(app).delete(`${path}/files/asset-1`)
      .set("X-Test-User", userId).expect(200);
    expect(removed.body.data.answers).toEqual({});
    expect(removeFromStorage).toHaveBeenCalledOnce();
    await request(app).put(`${path}/submit`).set("X-Test-User", userId).expect(400);

    await request(app).post(`${path}/files/file-1`).set("X-Test-User", userId)
      .attach("file", Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"), "document.pdf").expect(201);
    const submitted = await request(app).put(`${path}/submit`).set("X-Test-User", userId).expect(200);
    expect(submitted.body.data.submittedAt).toBeTruthy();
    expect(submitted.body.data.answers["file-1"]).toMatchObject([{ id: "asset-1" }]);
    await request(app).delete(`${path}/files/asset-1`).set("X-Test-User", userId).expect(400);
  });

  it("returns a completed submission even after the form closes", async () => {
    const form = await createForm({ isClosed: true });
    const submittedAt = new Date("2026-01-01T12:00:00.000Z");
    const submission = await FormSubmission.create({
      organizationId, formId: form.id,
      submissionStatusId: await getDefaultStatusId(form.id),
      submittedBy: userId, submittedAt, answers: {},
    });
    const result = await request(app).get(`/api/me/forms/${form.id}/submission`)
      .set("X-Test-User", userId).expect(200);
    expect(result.body.data.submission).toMatchObject({ id: submission.id, submittedAt: submittedAt.toISOString() });
    expect(await FormSubmission.countDocuments({ formId: form.id })).toBe(1);
    await request(app).get(`/api/me/forms/${form.id}/submission`)
      .set("X-Test-User", otherUserId).expect(409);
  });

  it("requires sign-in and rejects public, archived, or unknown forms", async () => {
    const form = await createForm();
    await request(app).get(`/api/me/forms/${form.id}/submission`).expect(401);
    const publicForm = await createForm({ type: "PUBLIC" });
    const archivedForm = await createForm({ archivedAt: new Date() });
    for (const id of [publicForm.id, archivedForm.id, new mongoose.Types.ObjectId().toString()]) {
      await request(app).get(`/api/me/forms/${id}/submission`).set("X-Test-User", userId).expect(404);
    }
    await request(app).get("/api/me/forms/not-an-id/submission").set("X-Test-User", userId).expect(400);
  });
});
