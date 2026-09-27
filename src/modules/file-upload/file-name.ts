import path from "node:path";
import { randomUUID } from "node:crypto";

const MAX_BASE_NAME_LENGTH = 80;
const MAX_EXTENSION_LENGTH = 12;

function normalizePart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getFileExtension(fileName: string): string {
  return normalizePart(path.extname(path.basename(fileName)).slice(1)).slice(
    0,
    MAX_EXTENSION_LENGTH,
  );
}

export function createStoredFileName(
  originalName: string,
  detectedExtension?: string,
): string {
  const safeOriginalName = path.basename(originalName);
  const rawOriginalExtension = path.extname(safeOriginalName);
  const originalExtension = getFileExtension(safeOriginalName);
  const extension = normalizePart(detectedExtension ?? originalExtension).slice(
    0,
    MAX_EXTENSION_LENGTH,
  );
  const rawBaseName = rawOriginalExtension
    ? safeOriginalName.slice(0, -rawOriginalExtension.length)
    : safeOriginalName;
  const baseName =
    normalizePart(rawBaseName).slice(0, MAX_BASE_NAME_LENGTH) || "file";
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

  return `${baseName}-${suffix}${extension ? `.${extension}` : ""}`;
}
