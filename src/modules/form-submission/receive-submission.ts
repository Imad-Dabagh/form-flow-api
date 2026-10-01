import busboy from "busboy";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Request } from "express";
import { z } from "zod";
import { storeFileStream } from "#app/modules/file-upload/index";
import { getFileExtension } from "#app/modules/file-upload/file-name";
import { isUploadExtensionInCategory, normalizeUploadExtension, type FormQuestionUploadPolicy } from "#app/modules/file-upload/policy";
import { MAX_UPLOAD_BYTES } from "#app/modules/file-upload/validation";
import { storageProvider, type StoredFileMetadata } from "#app/services/storage/index";
import { badRequest, payloadTooLarge, unsupportedMediaType } from "#app/utils/errors";
import { validateFormAnswers, type SubmissionSection, type ValidatedAnswer } from "./validate-form-answers.js";

const MAX_FILES = 10;
const MAX_ANSWERS_BYTES = 1024 * 1024;
const answersSchema = z.strictObject({ formAnswers: z.record(z.string(), z.unknown()) });

interface PendingFile {
  questionId: string;
  filePath: string;
  originalName: string;
  mimeType: string;
  truncated: boolean;
}

function parseAnswers(input: unknown): Record<string, unknown> {
  const result = answersSchema.safeParse(input);
  if (!result.success) throw badRequest("Send a formAnswers object.");
  return result.data.formAnswers;
}

async function receiveMultipart(req: Request, directory: string): Promise<{ answers: Record<string, unknown>; files: PendingFile[] }> {
  let parser;
  try {
    parser = busboy({
      headers: req.headers,
      limits: {
        files: MAX_FILES + 1,
        fields: 2,
        parts: MAX_FILES + 2,
        fileSize: MAX_UPLOAD_BYTES + 1,
        fieldSize: MAX_ANSWERS_BYTES + 1,
        headerPairs: 100,
      },
    });
  } catch {
    throw badRequest("The multipart submission is malformed.");
  }

  let answerText: string | undefined;
  let parseError: Error | undefined;
  const files: PendingFile[] = [];
  const writes: Promise<void>[] = [];
  const finished = new Promise<void>((resolve, reject) => {
    parser.on("field", (name, value, info) => {
      if (name !== "formAnswers" || answerText !== undefined) {
        parseError ??= badRequest("Send one formAnswers field.");
      } else if (info.valueTruncated) {
        parseError ??= payloadTooLarge("Form answers are too large.");
      } else {
        answerText = value;
      }
    });
    parser.on("file", (questionId, stream, info) => {
      if (!info.filename || files.length >= MAX_FILES) {
        parseError ??= badRequest(`Submit at most ${MAX_FILES} files.`);
        stream.resume();
        return;
      }
      const pending: PendingFile = {
        questionId,
        filePath: path.join(directory, randomUUID()),
        originalName: info.filename,
        mimeType: info.mimeType,
        truncated: false,
      };
      files.push(pending);
      stream.once("limit", () => { pending.truncated = true; });
      const write = pipeline(stream, createWriteStream(pending.filePath)).catch((error: unknown) => {
        parseError ??= error instanceof Error ? error : badRequest("Could not receive a file.");
      });
      writes.push(write);
    });
    parser.once("filesLimit", () => { parseError ??= badRequest(`Submit at most ${MAX_FILES} files.`); });
    parser.once("fieldsLimit", () => { parseError ??= badRequest("Only formAnswers and file fields are allowed."); });
    parser.once("partsLimit", () => { parseError ??= badRequest("Too many submission parts."); });
    parser.once("error", () => reject(badRequest("The multipart submission is malformed.")));
    parser.once("close", resolve);
  });
  req.once("aborted", () => parser.destroy(badRequest("The submission was aborted.")));
  req.pipe(parser);
  try {
    await finished;
  } finally {
    await Promise.all(writes);
  }
  if (parseError) throw parseError;
  if (answerText === undefined) throw badRequest("Send a formAnswers field.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(answerText);
  } catch {
    throw badRequest("formAnswers must contain valid JSON.");
  }
  return { answers: parseAnswers(parsed), files };
}

/** Validate answers against the saved form, store files, and save the response. */
export async function receiveSubmission<T>(
  req: Request,
  sections: SubmissionSection[],
  organizationId: string,
  save: (answers: ValidatedAnswer[]) => Promise<T>,
): Promise<T> {
  const contentType = req.headers["content-type"]?.toLowerCase() ?? "";
  if (!contentType.startsWith("multipart/form-data;")) {
    if (!contentType.startsWith("application/json")) throw unsupportedMediaType("Use JSON or multipart/form-data.");
    return save(validateFormAnswers(sections, parseAnswers(req.body)));
  }

  const contentLength = Number(req.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_FILES * MAX_UPLOAD_BYTES + MAX_ANSWERS_BYTES + 256 * 1024) {
    throw payloadTooLarge("The submission is too large.");
  }
  const directory = await mkdtemp(path.join(tmpdir(), "form-flow-submission-"));
  const storedFiles: StoredFileMetadata[] = [];
  try {
    const { answers, files } = await receiveMultipart(req, directory);
    validateFormAnswers(sections, answers, {}, true);
    const questions = new Map(sections.filter((section) => !section.isHidden)
      .flatMap((section) => section.questions)
      .filter((question) => question.inputType === "file")
      .map((question) => [question._id, question]));

    const pendingUploads = files.map((file) => {
      const question = questions.get(file.questionId);
      if (!question) throw badRequest("A file does not belong to a visible file question.", { questionId: file.questionId });
      if (file.truncated) throw payloadTooLarge(`Files must be ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB or smaller.`);
      const category = question.typeConfig?.uploadCategory ?? "all";
      const policy: FormQuestionUploadPolicy = {
        category,
        allowedExtensions: category === "all" ? [] : question.typeConfig?.allowedExtensions ?? [],
      };
      const extension = normalizeUploadExtension(getFileExtension(file.originalName));
      if (!isUploadExtensionInCategory(category, extension) ||
        (policy.allowedExtensions.length > 0 && !policy.allowedExtensions.includes(extension))) {
        throw badRequest("This file extension is not allowed for this question.", { questionId: file.questionId });
      }
      return { file, policy };
    });
    for (const question of questions.values()) {
      if (question.isRequired && !files.some((file) => file.questionId === question._id)) {
        throw badRequest(`${question.title}: An answer is required.`, { questionId: question._id });
      }
    }

    const uploaded: Record<string, StoredFileMetadata[]> = {};
    for (const { file, policy } of pendingUploads) {
      const metadata = await storeFileStream(createReadStream(file.filePath), {
        tenantId: `organization-${organizationId}`,
        storage: storageProvider,
        policy,
        originalName: file.originalName,
        declaredMimeType: file.mimeType,
      });
      storedFiles.push(metadata);
      (uploaded[file.questionId] ??= []).push(metadata);
    }
    return await save(validateFormAnswers(sections, answers, uploaded));
  } catch (error) {
    await Promise.allSettled(storedFiles.map((file) => storageProvider.delete(file)));
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
