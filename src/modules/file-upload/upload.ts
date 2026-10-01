import busboy from "busboy";
import type { Request } from "express";
import type { Readable } from "node:stream";
import { badRequest, payloadTooLarge, unsupportedMediaType } from "#app/utils/errors";
import type {
  StorageProvider,
  StoredFileMetadata,
} from "#app/services/storage/index";
import { createStoredFileName } from "./file-name.js";
import { MAX_UPLOAD_BYTES, prepareUploadStream } from "./validation.js";
import type { FormQuestionUploadPolicy } from "./policy.js";

const MAX_MULTIPART_OVERHEAD_BYTES = 256 * 1024;

export interface ReceiveFileOptions {
  tenantId: string;
  storage: StorageProvider;
  policy?: FormQuestionUploadPolicy;
}

export async function storeFileStream(
  source: Readable & { truncated?: boolean },
  { tenantId, storage, policy, originalName, declaredMimeType, signal }: ReceiveFileOptions & {
    originalName: string;
    declaredMimeType: string;
    signal?: AbortSignal;
  },
): Promise<StoredFileMetadata> {
  const prepared = await prepareUploadStream(source, originalName, declaredMimeType, policy);
  const fileName = createStoredFileName(originalName, prepared.detectedExtension);

  return storage.upload({
    stream: prepared.stream,
    tenantId,
    fileName,
    originalName,
    mimeType: prepared.mimeType,
    signal,
  });
}

export async function receiveFileUpload(
  req: Request,
  { tenantId, storage, policy }: ReceiveFileOptions,
): Promise<StoredFileMetadata> {
  const contentType = req.headers["content-type"] ?? "";

  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw unsupportedMediaType(
      "Use multipart/form-data with a single file field named 'file'.",
    );
  }

  const contentLength = Number(req.headers["content-length"]);
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
  ) {
    throw payloadTooLarge(
      `Files must be ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB or smaller.`,
    );
  }

  let parser;
  try {
    parser = busboy({
      headers: req.headers,
      limits: {
        // The extra byte lets validation distinguish an exact-limit file from
        // an oversized file; Busboy marks a stream truncated at its limit.
        fileSize: MAX_UPLOAD_BYTES + 1,
        files: 1,
        fields: 0,
        // Busboy emits partsLimit when this count is reached, so two lets us
        // accept one part and reject as soon as a second part is encountered.
        parts: 2,
        headerPairs: 100,
      },
    });
  } catch {
    throw badRequest("The multipart upload is malformed.");
  }

  const abortController = new AbortController();
  let uploadTask: Promise<StoredFileMetadata> | undefined;
  let requestError: unknown;

  const parserFinished = new Promise<void>((resolve, reject) => {
    parser.on("file", (fieldName, file, info) => {
      if (fieldName !== "file" || !info.filename || uploadTask) {
        file.resume();
        requestError ??= badRequest(
          "Send exactly one file using the field name 'file'.",
        );
        return;
      }

      uploadTask = storeFileStream(file, {
        tenantId,
        storage,
        policy,
        originalName: info.filename,
        declaredMimeType: info.mimeType,
        signal: abortController.signal,
      });

      // Attach a handler immediately; the task is awaited after parsing ends.
      void uploadTask.catch(() => undefined);
    });
    parser.once("filesLimit", () => {
      requestError ??= badRequest("Only one file can be uploaded at a time.");
      abortController.abort(requestError);
    });
    parser.once("fieldsLimit", () => {
      requestError ??= badRequest("Additional multipart fields are not allowed.");
      abortController.abort(requestError);
    });
    parser.once("partsLimit", () => {
      requestError ??= badRequest("Only one multipart file part is allowed.");
      abortController.abort(requestError);
    });
    parser.once("error", reject);
    parser.once("close", resolve);
  });

  req.once("aborted", () => {
    requestError ??= badRequest("The upload was aborted.");
    abortController.abort(requestError);
    parser.destroy(requestError as Error);
  });
  req.pipe(parser);

  await parserFinished;

  if (requestError) {
    throw requestError;
  }

  if (!uploadTask) {
    throw badRequest("A file field named 'file' is required.");
  }

  return uploadTask;
}
