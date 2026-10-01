export const UPLOAD_CATEGORIES = ["all", "documents", "images"] as const;

export type UploadCategory = (typeof UPLOAD_CATEGORIES)[number];

export interface FormQuestionUploadPolicy {
  category: UploadCategory;
  allowedExtensions: readonly string[];
}

// Initial extension choices for form-question upload rules.
const documentExtensions = ["pdf", "docx", "xlsx", "pptx"];
const imageExtensions = ["jpg", "png", "webp", "gif"];

export const UPLOAD_EXTENSIONS: Record<UploadCategory, readonly string[]> = {
  all: [...documentExtensions, ...imageExtensions],
  documents: documentExtensions,
  images: imageExtensions,
};

export const UPLOAD_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export function normalizeUploadExtension(extension: string): string {
  const normalized = extension.trim().replace(/^\./, "").toLowerCase();
  return normalized === "jpeg" ? "jpg" : normalized;
}

export function isUploadExtensionInCategory(
  category: UploadCategory,
  extension: string,
): boolean {
  return UPLOAD_EXTENSIONS[category].includes(normalizeUploadExtension(extension));
}
