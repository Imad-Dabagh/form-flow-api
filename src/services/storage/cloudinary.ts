import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  v2 as cloudinary,
  type UploadApiErrorResponse,
  type UploadApiResponse,
} from "cloudinary";
import config from "../../config/index.js";
import type {
  StorageProvider,
  StorageUploadInput,
  StoredFileMetadata,
} from "./types.js";

type CloudinaryResourceType = "image" | "raw" | "video";
const UPLOAD_TIMEOUT_MS = 60_000;

cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
  secure: true,
});

function getResourceType(mimeType: string): CloudinaryResourceType {
  if (mimeType.startsWith("image/")) {
    return "image";
  }

  // Cloudinary stores audio under its video resource type.
  return mimeType.startsWith("audio/") ? "video" : "raw";
}

function getTenantPath(tenantId: string): string {
  const normalizedTenantId = tenantId.replace(/[^a-zA-Z0-9_-]/g, "");

  if (!normalizedTenantId) {
    throw new Error("A valid tenant ID is required for storage.");
  }

  return `tenants/${normalizedTenantId}/files`;
}

function createSignedUrl(result: UploadApiResponse): string {
  return cloudinary.url(result.public_id, {
    secure: true,
    sign_url: true,
    type: "authenticated",
    resource_type: result.resource_type,
    version: result.version,
    ...(result.resource_type !== "raw" && result.format
      ? { format: result.format }
      : {}),
  });
}

function toStoredFile(
  result: UploadApiResponse,
  input: StorageUploadInput,
): StoredFileMetadata {
  return {
    id: String(result.asset_id),
    storageKey: result.public_id,
    provider: "cloudinary",
    url: createSignedUrl(result),
    name: input.fileName,
    originalName: input.originalName,
    extension: path.extname(input.fileName).slice(1),
    mimeType: input.mimeType,
    size: result.bytes,
    ...(result.width ? { width: result.width } : {}),
    ...(result.height ? { height: result.height } : {}),
    ...(result.etag ? { checksum: result.etag } : {}),
    createdAt: result.created_at,
  };
}

class CloudinaryStorageProvider implements StorageProvider {
  async upload(input: StorageUploadInput): Promise<StoredFileMetadata> {
    const resourceType = getResourceType(input.mimeType);
    const publicFileName =
      resourceType === "raw" ? input.fileName : path.parse(input.fileName).name;
    const publicId = `${getTenantPath(input.tenantId)}/${publicFileName}`;

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: NodeJS.Timeout | undefined;
      const fail = (error: unknown) => {
        if (!settled) {
          settled = true;
          if (timeout) {
            clearTimeout(timeout);
          }
          reject(error);
        }
      };

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: resourceType,
          type: "authenticated",
          public_id: publicId,
          overwrite: false,
          unique_filename: false,
          use_filename: false,
          filename_override: input.fileName,
        },
        (
          error?: UploadApiErrorResponse,
          result?: UploadApiResponse,
        ) => {
          if (error) {
            return fail(error);
          }

          if (!result) {
            return fail(new Error("Cloudinary returned no upload result."));
          }

          if (!settled) {
            settled = true;
            if (timeout) {
              clearTimeout(timeout);
            }
            resolve(toStoredFile(result, input));
          }
        },
      );

      timeout = setTimeout(() => {
        const error = new Error("The storage upload timed out.");
        uploadStream.destroy(error);
        fail(error);
      }, UPLOAD_TIMEOUT_MS);

      void pipeline(input.stream, uploadStream, {
        signal: input.signal,
      }).catch(fail);
    });
  }
}

export default new CloudinaryStorageProvider();
