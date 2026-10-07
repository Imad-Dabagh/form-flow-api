import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createStoredFileName, prepareUploadStream } from "../src/modules/file-upload/index.js";

describe("generic file uploads", () => {
  it("creates readable collision-resistant file names", () => {
    const fileName = createStoredFileName("  Q3 Résumé & Results!!.PDF  ");

    expect(fileName).toMatch(/^q3-resume-results-[a-f0-9]{12}\.pdf$/);
  });

  it("rejects video uploads before calling storage", async () => {
    const stream = Readable.from([Buffer.from("not-a-video")]);

    await expect(prepareUploadStream(stream, "recording.mp4", "video/mp4")).rejects.toMatchObject({
      statusCode: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
  });

  it("rejects dangerous executable extensions", async () => {
    const stream = Readable.from([Buffer.from("echo unsafe")]);

    await expect(prepareUploadStream(stream, "script.sh", "text/plain")).rejects.toMatchObject({
      statusCode: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
  });
});
