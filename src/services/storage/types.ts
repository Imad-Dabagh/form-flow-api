import type { Readable } from "node:stream";

export interface StorageUploadInput {
  stream: Readable;
  tenantId: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  signal?: AbortSignal;
}

export interface StoredFileMetadata {
  id: string;
  storageKey: string;
  provider: string;
  url: string;
  name: string;
  originalName: string;
  extension: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  checksum?: string;
  createdAt: string;
}

export interface StorageProvider {
  upload(input: StorageUploadInput): Promise<StoredFileMetadata>;
}
