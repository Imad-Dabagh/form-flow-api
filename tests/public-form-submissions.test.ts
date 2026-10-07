import { randomUUID } from "node:crypto";
import express from "express";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import FormSubmission from "../src/modules/form-submission/models/index.js";
import FormSubmissionStatus from "../src/modules/form-submission-status/models/index.js";
import Form from "../src/modules/form/models/index.js";
import publicSubmit from "../src/routes/public/forms/[formId]/submit.js";

const organizationId = "000000000000000000000001";
const userId = "000000000000000000000002";
const answers = { formAnswers: { "question-1": "Looks good" } };

const app = express();
app.use(express.json());
app.use("/api/public/forms/:formId/submissions/submit", publicSubmit);
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
  await FormSubmission.init();
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

async function createPublicForm(
  sections = [
    {
      _id: "section-1",
      title: "Details",
      questions: [
        {
          _id: "question-1",
          title: "Feedback",
          inputType: "string",
          isRequired: true,
        },
      ],
    },
  ],
) {
  const form = await Form.create({
    organizationId,
    createdBy: userId,
    name: "Feedback",
    type: "PUBLIC",
    sections,
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

describe("direct form submissions", () => {
  it("records a completed public submission without a draft", async () => {
    const form = await createPublicForm();
    const key = randomUUID();
    const url = `/api/public/forms/${form.id}/submissions/submit`;
    const response = await request(app)
      .put(url)
      .set("Idempotency-Key", key)
      .send(answers)
      .expect(201);
    const retry = await request(app).put(url).set("Idempotency-Key", key).send(answers).expect(200);

    expect(retry.body.data.id).toBe(response.body.data.id);
    const record = await FormSubmission.findById(response.body.data.id).lean();
    expect(record?.submittedAt).toBeInstanceOf(Date);
    expect(record?.submittedBy).toBeNull();
    expect(record?.submissionStatusId).toBeTruthy();
    expect(record?.answers["question-1"]).toBe("Looks good");
    expect(await FormSubmission.countDocuments({ formId: form.id })).toBe(1);
  });

  it("creates one submission when matching public requests arrive together", async () => {
    const form = await createPublicForm();
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
    const form = await createPublicForm();
    const url = `/api/public/forms/${form.id}/submissions/submit`;
    const key = randomUUID();

    const first = await request(app).put(url).set("Idempotency-Key", key).send(answers).expect(201);
    await Form.updateOne({ _id: form._id }, { isClosed: true });
    const retry = await request(app).put(url).set("Idempotency-Key", key).send(answers).expect(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await FormSubmission.countDocuments({ formId: form.id })).toBe(1);
  });

  it("rejects new submissions to a closed form", async () => {
    const form = await createPublicForm();
    await Form.updateOne({ _id: form._id }, { isClosed: true });
    const response = await request(app)
      .put(`/api/public/forms/${form.id}/submissions/submit`)
      .set("Idempotency-Key", randomUUID())
      .send(answers)
      .expect(409);

    expect(response.body.code).toBe("FORM_CLOSED");
    expect(await FormSubmission.countDocuments({ formId: form._id })).toBe(0);
  });

  it("accepts zero as a required number and rejects an invalid date", async () => {
    const form = await createPublicForm([
      {
        _id: "section-1",
        title: "Metrics",
        questions: [
          { _id: "count", title: "Count", inputType: "number", isRequired: true },
          { _id: "date", title: "Date", inputType: "datetime", isRequired: true },
        ],
      },
    ]);
    const url = `/api/public/forms/${form.id}/submissions/submit`;
    const key = randomUUID();

    await request(app)
      .put(url)
      .set("Idempotency-Key", key)
      .send({ formAnswers: { count: 0, date: "2026-02-30" } })
      .expect(400);
    const submitted = await request(app)
      .put(url)
      .set("Idempotency-Key", key)
      .send({ formAnswers: { count: 0, date: "2026-02-28" } })
      .expect(201);
    const record = await FormSubmission.findById(submitted.body.data.id).lean();
    expect(record?.answers.count).toBe(0);
  });

  it("accepts an absolute website URL and rejects other schemes or incomplete links", async () => {
    const form = await createPublicForm([
      {
        _id: "section-1",
        title: "Links",
        questions: [{ _id: "website", title: "Portfolio URL", inputType: "url", isRequired: true }],
      },
    ]);
    const endpoint = `/api/public/forms/${form.id}/submissions/submit`;

    for (const website of ["example.com", "javascript:alert(1)", "ftp://example.com"]) {
      await request(app)
        .put(endpoint)
        .set("Idempotency-Key", randomUUID())
        .send({ formAnswers: { website } })
        .expect(400);
    }

    const submitted = await request(app)
      .put(endpoint)
      .set("Idempotency-Key", randomUUID())
      .send({ formAnswers: { website: " https://example.com/portfolio " } })
      .expect(201);
    const record = await FormSubmission.findById(submitted.body.data.id).lean();
    expect(record?.answers.website).toBe("https://example.com/portfolio");
  });
});
