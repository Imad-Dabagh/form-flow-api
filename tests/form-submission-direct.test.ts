import { randomUUID } from "node:crypto";
import express from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import FormSubmission from "../src/modules/form-submission/models/index.js";
import Form from "../src/modules/form/models/index.js";
import authenticatedSubmit from "../src/routes/orgs/[organizationSlug]/forms/[formId]/form-submission.js";
import publicSubmit from "../src/routes/public/forms/[formId]/submit.js";

const organizationId = "000000000000000000000001";
const userId = "000000000000000000000002";
const answers = { formAnswers: { "question-1": "Looks good" } };

const app = express();
app.use(express.json());
app.use("/api/public/forms/:formId/submissions/submit", publicSubmit);
app.use("/api/orgs/:organizationSlug/forms/:formId", (req, _res, next) => {
  Object.assign(req, {
    auth: { userId },
    organizationAccess: { organizationId },
  });
  next();
}, authenticatedSubmit);
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

async function createForm(type: "PUBLIC" | "AUTHENTICATED") {
  return Form.create({
    organizationId,
    createdBy: userId,
    name: "Feedback",
    type,
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

describe("direct form submissions", () => {
  it("records a completed public submission without a draft", async () => {
    const form = await createForm("PUBLIC");
    const key = randomUUID();
    const url = `/api/public/forms/${form.id}/submissions/submit`;
    const response = await request(app)
      .put(url).set("Idempotency-Key", key)
      .send(answers).expect(201);
    const retry = await request(app).put(url).set("Idempotency-Key", key)
      .send(answers).expect(200);

    expect(retry.body.data.id).toBe(response.body.data.id);
    const record = await FormSubmission.findById(response.body.data.id).lean();
    expect(record?.submittedAt).toBeInstanceOf(Date);
    expect(record?.submittedBy).toBeNull();
    expect(record?.answers[0].value).toBe("Looks good");
    expect(await FormSubmission.countDocuments({ formId: form.id })).toBe(1);
  });

  it("records the signed-in user for a direct authenticated submission", async () => {
    const form = await createForm("AUTHENTICATED");
    const key = randomUUID();
    const url = `/api/orgs/alpha/forms/${form.id}/submissions/submit`;
    const response = await request(app)
      .put(url)
      .set("Idempotency-Key", key)
      .send(answers).expect(201);
    const retry = await request(app).put(url).set("Idempotency-Key", key)
      .send(answers).expect(200);

    expect(retry.body.data.id).toBe(response.body.data.id);
    const record = await FormSubmission.findById(response.body.data.id).lean();
    expect(String(record?.submittedBy)).toBe(userId);
    expect(record?.submittedAt).toBeInstanceOf(Date);
  });

  it("creates one submission when matching public requests arrive together", async () => {
    const form = await createForm("PUBLIC");
    const url = `/api/public/forms/${form.id}/submissions/submit`;
    const key = randomUUID();

    const [first, second] = await Promise.all([
      request(app).put(url).set("Idempotency-Key", key).send(answers),
      request(app).put(url).set("Idempotency-Key", key).send(answers),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body.data.id).toBe(second.body.data.id);
    expect(await FormSubmission.countDocuments({ formId: form.id })).toBe(1);
  });

  it("acknowledges a successful retry after the form closes", async () => {
    const form = await createForm("PUBLIC");
    const url = `/api/public/forms/${form.id}/submissions/submit`;
    const key = randomUUID();

    const first = await request(app).put(url).set("Idempotency-Key", key)
      .send(answers).expect(201);
    await Form.updateOne({ _id: form._id }, { isClosed: true });
    const retry = await request(app).put(url).set("Idempotency-Key", key)
      .send(answers).expect(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await FormSubmission.countDocuments({ formId: form.id })).toBe(1);
  });

  it("rejects new submissions to a closed form", async () => {
    const form = await createForm("PUBLIC");
    await Form.updateOne({ _id: form._id }, { isClosed: true });
    const response = await request(app)
      .put(`/api/public/forms/${form.id}/submissions/submit`)
      .set("Idempotency-Key", randomUUID())
      .send(answers).expect(409);

    expect(response.body.code).toBe("FORM_CLOSED");
    expect(await FormSubmission.countDocuments({ formId: form._id })).toBe(0);
  });

  it("accepts zero as a required number and rejects an invalid date", async () => {
    const form = await Form.create({
      organizationId,
      createdBy: userId,
      name: "Metrics",
      type: "PUBLIC",
      sections: [{
        _id: "section-1",
        title: "Metrics",
        questions: [
          { _id: "count", name: "count", title: "Count", inputType: "number", isRequired: true },
          { _id: "date", name: "date", title: "Date", inputType: "datetime", isRequired: true },
        ],
      }],
    });
    const url = `/api/public/forms/${form.id}/submissions/submit`;
    const key = randomUUID();

    await request(app).put(url).set("Idempotency-Key", key)
      .send({ formAnswers: { count: 0, date: "2026-02-30" } }).expect(400);
    const submitted = await request(app).put(url).set("Idempotency-Key", key)
      .send({ formAnswers: { count: 0, date: "2026-02-28" } }).expect(201);
    const record = await FormSubmission.findById(submitted.body.data.id).lean();
    expect(record?.answers.find((answer) => answer.questionId === "count")?.value).toBe(0);
  });
});
