import { randomUUID } from "node:crypto";
import express from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import FormSubmission from "../src/modules/form-submission/models/index.js";
import Form from "../src/modules/form/models/index.js";
import authenticatedSubmit from "../src/routes/orgs/[organizationSlug]/forms/[formId]/submit.js";
import publicSubmit from "../src/routes/public/forms/[formId]/submit.js";

const organizationId = "000000000000000000000001";
const userId = "000000000000000000000002";
const answers = { formAnswers: { "question-1": "Looks good" } };

const app = express();
app.use(express.json());
app.use("/api/public/forms/:formId/submissions/submit", publicSubmit);
app.use("/api/orgs/:organizationSlug/forms/:formId/submissions/submit", (req, _res, next) => {
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

describe("form submission retries", () => {
  it("returns one public submission for repeated requests with the same key", async () => {
    const form = await createForm("PUBLIC");
    const url = `/api/public/forms/${form.id}/submissions/submit`;
    const key = randomUUID();

    const first = await request(app).put(url).set("Idempotency-Key", key)
      .send(answers).expect(201);
    const retry = await request(app).put(url).set("Idempotency-Key", key)
      .send(answers).expect(200);

    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await FormSubmission.countDocuments({ formId: form._id })).toBe(1);
  });

  it("returns one authenticated submission for repeated requests with the same key", async () => {
    const form = await createForm("AUTHENTICATED");
    const url = `/api/orgs/alpha/forms/${form.id}/submissions/submit`;
    const key = randomUUID();

    const first = await request(app).put(url).set("Idempotency-Key", key)
      .send(answers).expect(201);
    const retry = await request(app).put(url).set("Idempotency-Key", key)
      .send(answers).expect(200);

    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await FormSubmission.countDocuments({ formId: form._id, submittedBy: userId })).toBe(1);
  });

  it("creates only one response when matching public requests arrive together", async () => {
    const form = await createForm("PUBLIC");
    const url = `/api/public/forms/${form.id}/submissions/submit`;
    const key = randomUUID();

    const [first, second] = await Promise.all([
      request(app).put(url).set("Idempotency-Key", key).send(answers),
      request(app).put(url).set("Idempotency-Key", key).send(answers),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body.data.id).toBe(second.body.data.id);
    expect(await FormSubmission.countDocuments({ formId: form._id })).toBe(1);
  });

  it("rejects new responses to a closed form but acknowledges a successful retry", async () => {
    const form = await createForm("PUBLIC");
    const url = `/api/public/forms/${form.id}/submissions/submit`;
    const key = randomUUID();

    await request(app).put(url).set("Idempotency-Key", key)
      .send(answers).expect(201);
    await Form.updateOne({ _id: form._id }, { isClosed: true });

    const retry = await request(app).put(url).set("Idempotency-Key", key)
      .send(answers).expect(200);
    expect(retry.body.data.id).toBeDefined();
    const newResponse = await request(app).put(url).set("Idempotency-Key", randomUUID())
      .send(answers).expect(409);
    expect(newResponse.body.code).toBe("FORM_CLOSED");
    expect(await FormSubmission.countDocuments({ formId: form._id })).toBe(1);
  });
});
