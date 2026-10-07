import express from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/middlewares/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/middlewares/index.js")>();
  return {
    ...actual,
    authenticate: (
      req: { auth?: unknown; get(name: string): string | undefined },
      _res: unknown,
      next: () => void,
    ) => {
      req.auth = {
        userId: req.get("x-test-user-id"),
        isEmailVerified: true,
        isSuperAdmin: false,
      };
      next();
    },
  };
});

import profileRoutes from "../src/routes/me/index.js";
import Membership from "../src/modules/membership/models/index.js";
import User from "../src/modules/user/models/index.js";

const app = express();
app.use(express.json());
app.use("/api/me", profileRoutes);
app.use(
  (
    error: { statusCode?: number; code?: string },
    _req: unknown,
    res: express.Response,
    _next: unknown,
  ) => {
    res.status(error.statusCode ?? 500).json({ code: error.code ?? "INTERNAL_ERROR" });
  },
);

let mongo: MongoMemoryServer;
let userId: string;

function profileRequest() {
  return request(app).put("/api/me").set("x-test-user-id", userId);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120_000);

beforeEach(async () => {
  await Membership.deleteMany({});
  await User.deleteMany({});
  const user = await User.create({
    authUserId: "auth-user-1",
    email: "person@example.com",
    firstName: "Existing",
    lastName: "Person",
  });
  userId = String(user._id);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe("current profile", () => {
  it("returns profile details with session-derived flags", async () => {
    await User.updateOne(
      { _id: userId },
      {
        coverPhoto: "https://example.com/cover.jpg",
        phone: "+1 555 0100",
        shortDescription: "About me",
      },
    );

    const response = await request(app).get("/api/me").set("x-test-user-id", userId).expect(200);
    expect(response.body.data).toMatchObject({
      email: "person@example.com",
      firstName: "Existing",
      lastName: "Person",
      coverPhoto: "https://example.com/cover.jpg",
      phone: "+1 555 0100",
      shortDescription: "About me",
      isEmailVerified: true,
      isSuperAdmin: false,
    });
  });

  it("updates and clears optional profile fields without requiring them in later requests", async () => {
    const updated = await profileRequest()
      .send({
        firstName: " New ",
        lastName: " Name ",
        profilePic: "https://example.com/avatar.jpg",
        coverPhoto: "https://example.com/cover.jpg",
        phone: " +1 555 0100 ",
        shortDescription: " Hello world ",
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      firstName: "New",
      lastName: "Name",
      profilePic: "https://example.com/avatar.jpg",
      coverPhoto: "https://example.com/cover.jpg",
      phone: "+1 555 0100",
      shortDescription: "Hello world",
      onboardingCompletedAt: null,
    });

    const kept = await profileRequest().send({ firstName: "New", lastName: "Name" }).expect(200);
    expect(kept.body.data.coverPhoto).toBe("https://example.com/cover.jpg");
    expect(kept.body.data.phone).toBe("+1 555 0100");

    const cleared = await profileRequest()
      .send({
        firstName: "New",
        lastName: "Name",
        coverPhoto: "",
        phone: "",
        shortDescription: "",
      })
      .expect(200);
    expect(cleared.body.data).toMatchObject({
      coverPhoto: "",
      phone: "",
      shortDescription: "",
    });
  });

  it("rejects account fields and invalid profile values", async () => {
    const names = { firstName: "Existing", lastName: "Person" };
    await profileRequest()
      .send({ ...names, email: "other@example.com" })
      .expect(400);
    await profileRequest()
      .send({ ...names, coverPhoto: "http://example.com/cover.jpg" })
      .expect(400);
    await profileRequest()
      .send({ ...names, phone: "x".repeat(31) })
      .expect(400);
    await profileRequest()
      .send({ ...names, shortDescription: "x".repeat(501) })
      .expect(400);
    expect((await User.findById(userId))?.email).toBe("person@example.com");
  });

  it("keeps the existing onboarding completion rule for members", async () => {
    await Membership.create({
      userId,
      organizationId: new mongoose.Types.ObjectId(),
      role: "ADMIN",
    });

    const response = await profileRequest()
      .send({ firstName: "Existing", lastName: "Person" })
      .expect(200);
    expect(response.body.data.onboardingCompletedAt).not.toBeNull();
  });
});
