import { Readable } from "node:stream";
import { fileTypeFromBuffer } from "file-type";
import {
  badRequest,
  payloadTooLarge,
  unsupportedMediaType,
} from "../../utils/errors.js";
import { getFileExtension } from "./file-name.js";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const INSPECTION_BYTES = 8 * 1024;

const blockedExtensions = new Set([
  "3g2",
  "3gp",
  "apk",
  "app",
  "avi",
  "bat",
  "bin",
  "cmd",
  "com",
  "cpl",
  "dll",
  "dmg",
  "exe",
  "flv",
  "hta",
  "html",
  "htm",
  "iso",
  "jar",
  "js",
  "jse",
  "lnk",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "mjs",
  "msi",
  "php",
  "ps1",
  "scr",
  "sh",
  "svg",
  "vbs",
  "wasm",
  "webm",
  "wmv",
]);

const blockedMimeTypes = new Set([
  "application/java-archive",
  "application/javascript",
  "application/vnd.android.package-archive",
  "application/vnd.microsoft.portable-executable",
  "application/wasm",
  "application/x-apple-diskimage",
  "application/x-dosexec",
  "application/x-executable",
  "application/x-msdownload",
  "application/x-sharedlib",
  "application/x-shockwave-flash",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/html",
  "text/javascript",
]);

function normalizeMimeType(value: string): string {
  return value.split(";", 1)[0].trim().toLowerCase();
}

function assertAllowedMimeType(mimeType: string): void {
  if (
    mimeType.startsWith("video/") ||
    blockedMimeTypes.has(mimeType)
  ) {
    throw unsupportedMediaType("This file type is not allowed.");
  }
}

function assertAllowedExtension(extension: string): void {
  if (extension && blockedExtensions.has(extension)) {
    throw unsupportedMediaType("This file extension is not allowed.");
  }
}

async function drain(iterator: AsyncIterator<unknown>): Promise<void> {
  try {
    while (!(await iterator.next()).done) {
      // Consume the rejected part so the multipart parser can finish cleanly.
    }
  } catch {
    // The original validation error is more useful than a drain failure.
  }
}

export interface PreparedUpload {
  stream: Readable;
  mimeType: string;
  detectedExtension?: string;
}

export async function prepareUploadStream(
  source: Readable & { truncated?: boolean },
  originalName: string,
  declaredMimeType: string,
): Promise<PreparedUpload> {
  const extension = getFileExtension(originalName);
  const normalizedDeclaredMimeType = normalizeMimeType(declaredMimeType);

  if (!originalName.trim()) {
    source.resume();
    throw badRequest("The uploaded file must have a name.");
  }

  try {
    assertAllowedExtension(extension);
    assertAllowedMimeType(normalizedDeclaredMimeType);
  } catch (error) {
    source.resume();
    throw error;
  }

  const iterator = source[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  let inspectedBytes = 0;
  let inputEnded = false;

  while (inspectedBytes < INSPECTION_BYTES) {
    const next = await iterator.next();

    if (next.done) {
      inputEnded = true;
      break;
    }

    const chunk = Buffer.isBuffer(next.value)
      ? next.value
      : Buffer.from(next.value as Uint8Array);
    chunks.push(chunk);
    inspectedBytes += chunk.length;
  }

  const prefix = Buffer.concat(chunks);

  if (!prefix.length) {
    void drain(iterator);
    throw badRequest("The uploaded file is empty.");
  }

  const detectedType = await fileTypeFromBuffer(prefix);

  try {
    if (detectedType) {
      assertAllowedMimeType(detectedType.mime);
      assertAllowedExtension(detectedType.ext);
    }
  } catch (error) {
    void drain(iterator);
    throw error;
  }

  async function* replay(): AsyncGenerator<Buffer> {
    let totalBytes = prefix.length;
    yield prefix;

    if (!inputEnded) {
      while (true) {
        const next = await iterator.next();

        if (next.done) {
          break;
        }

        const chunk = Buffer.isBuffer(next.value)
          ? next.value
          : Buffer.from(next.value as Uint8Array);

        totalBytes += chunk.length;
        if (totalBytes > MAX_UPLOAD_BYTES) {
          throw payloadTooLarge(
            `Files must be ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB or smaller.`,
          );
        }

        yield chunk;
      }
    }

    if (source.truncated) {
      throw payloadTooLarge(
        `Files must be ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB or smaller.`,
      );
    }
  }

  return {
    stream: Readable.from(replay()),
    mimeType:
      detectedType?.mime || normalizedDeclaredMimeType || "application/octet-stream",
    ...(detectedType?.ext ? { detectedExtension: detectedType.ext } : {}),
  };
}
