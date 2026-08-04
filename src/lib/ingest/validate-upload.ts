/**
 * Upload validation. Pure functions with no I/O so they are directly testable.
 *
 * Three independent checks, because any one alone is bypassable: the declared
 * MIME type, the file extension, and the leading magic bytes must all agree.
 * A .exe renamed to .pdf fails the magic-byte check even though the browser
 * reports application/pdf.
 */

export type SupportedKind = "pdf" | "docx" | "markdown" | "text" | "csv";

interface FileTypeSpec {
  kind: SupportedKind;
  extensions: string[];
  mimeTypes: string[];
  /** Leading bytes that must match, if the format has a stable signature. */
  magic?: number[][];
}

const FILE_TYPES: FileTypeSpec[] = [
  {
    kind: "pdf",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    magic: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  },
  {
    kind: "docx",
    extensions: [".docx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    magic: [[0x50, 0x4b, 0x03, 0x04]], // PK.. (zip container)
  },
  {
    kind: "markdown",
    extensions: [".md", ".markdown"],
    mimeTypes: ["text/markdown", "text/x-markdown", "text/plain", ""],
  },
  {
    kind: "text",
    extensions: [".txt"],
    mimeTypes: ["text/plain", ""],
  },
  {
    kind: "csv",
    extensions: [".csv"],
    mimeTypes: ["text/csv", "application/csv", "text/plain", ""],
  },
];

export const SUPPORTED_EXTENSIONS = FILE_TYPES.flatMap((t) => t.extensions);

export type ValidationResult =
  | { ok: true; kind: SupportedKind; safeFilename: string }
  | { ok: false; error: string };

/**
 * Strips directory components and control characters. Storage keys are built
 * from IDs rather than this value; it is only what we display back to the user.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "file";
  const cleaned = base
    .replace(/[\u0000-\u001F\u007F]/g, "")
    // Leading dots would create hidden files or enable ".." traversal.
    .replace(/^\.+/, "")
    .trim();
  return cleaned.slice(0, 255) || "file";
}

export function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

function matchesMagic(bytes: Uint8Array, spec: FileTypeSpec): boolean {
  if (!spec.magic) return true; // Plain-text formats have no signature.
  return spec.magic.some((sig) =>
    sig.every((byte, i) => bytes[i] === byte),
  );
}

export interface ValidateUploadInput {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** First bytes of the file; only the leading few are inspected. */
  head: Uint8Array;
  maxBytes: number;
}

export function validateUpload(input: ValidateUploadInput): ValidationResult {
  const { filename, mimeType, sizeBytes, head, maxBytes } = input;

  if (sizeBytes <= 0) {
    return { ok: false, error: "File is empty" };
  }
  if (sizeBytes > maxBytes) {
    const mb = (maxBytes / 1_048_576).toFixed(1);
    return { ok: false, error: `File exceeds the ${mb} MB limit` };
  }

  const safeFilename = sanitizeFilename(filename);
  const ext = getExtension(safeFilename);

  const spec = FILE_TYPES.find((t) => t.extensions.includes(ext));
  if (!spec) {
    return {
      ok: false,
      error: `Unsupported file type "${ext || "unknown"}". Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`,
    };
  }

  const declaredMime = (mimeType || "").split(";")[0].trim().toLowerCase();
  if (!spec.mimeTypes.includes(declaredMime)) {
    return {
      ok: false,
      error: `File extension "${ext}" does not match its content type "${declaredMime || "unknown"}"`,
    };
  }

  if (!matchesMagic(head, spec)) {
    return {
      ok: false,
      error: `File content does not look like a valid ${spec.kind.toUpperCase()} file`,
    };
  }

  return { ok: true, kind: spec.kind, safeFilename };
}
