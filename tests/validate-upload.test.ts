import { describe, expect, it } from "vitest";
import {
  sanitizeFilename,
  validateUpload,
} from "@/lib/ingest/validate-upload";

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // PK..
const TEXT_HEAD = new TextEncoder().encode("hello");

const base = {
  sizeBytes: 1000,
  maxBytes: 10_485_760,
};

describe("validateUpload — accepting supported files", () => {
  it("accepts a real PDF", () => {
    const result = validateUpload({
      ...base,
      filename: "runbook.pdf",
      mimeType: "application/pdf",
      head: PDF_MAGIC,
    });

    expect(result).toMatchObject({ ok: true, kind: "pdf" });
  });

  it("accepts a DOCX by its zip signature", () => {
    const result = validateUpload({
      ...base,
      filename: "policy.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      head: ZIP_MAGIC,
    });

    expect(result).toMatchObject({ ok: true, kind: "docx" });
  });

  it.each([
    ["notes.md", "text/markdown", "markdown"],
    ["notes.txt", "text/plain", "text"],
    ["hosts.csv", "text/csv", "csv"],
  ])("accepts %s", (filename, mimeType, kind) => {
    const result = validateUpload({ ...base, filename, mimeType, head: TEXT_HEAD });
    expect(result).toMatchObject({ ok: true, kind });
  });

  it("tolerates a charset parameter on the content type", () => {
    const result = validateUpload({
      ...base,
      filename: "notes.txt",
      mimeType: "text/plain; charset=utf-8",
      head: TEXT_HEAD,
    });

    expect(result.ok).toBe(true);
  });
});

describe("validateUpload — size limits", () => {
  it("rejects a file over the limit", () => {
    const result = validateUpload({
      filename: "big.pdf",
      mimeType: "application/pdf",
      head: PDF_MAGIC,
      sizeBytes: 20_000_000,
      maxBytes: 10_485_760,
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/exceeds the 10\.0 MB limit/);
  });

  it("rejects an empty file", () => {
    const result = validateUpload({
      ...base,
      filename: "empty.txt",
      mimeType: "text/plain",
      head: new Uint8Array(),
      sizeBytes: 0,
    });

    expect(result).toMatchObject({ ok: false });
  });
});

describe("validateUpload — type checks", () => {
  it("rejects an unsupported extension", () => {
    const result = validateUpload({
      ...base,
      filename: "payload.exe",
      mimeType: "application/octet-stream",
      head: TEXT_HEAD,
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/Unsupported file type/);
  });

  it("rejects a file whose extension and content type disagree", () => {
    const result = validateUpload({
      ...base,
      filename: "trick.pdf",
      mimeType: "application/x-msdownload",
      head: PDF_MAGIC,
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/does not match/);
  });

  it("rejects a non-PDF renamed to .pdf even when the browser reports application/pdf", () => {
    // The whole point of the magic-byte check: extension and MIME both lie.
    const result = validateUpload({
      ...base,
      filename: "malware.pdf",
      mimeType: "application/pdf",
      head: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), // MZ = Windows executable
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/does not look like a valid PDF/);
  });

  it("rejects a DOCX that is not a zip container", () => {
    const result = validateUpload({
      ...base,
      filename: "fake.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      head: TEXT_HEAD,
    });

    expect(result).toMatchObject({ ok: false });
  });
});

describe("sanitizeFilename", () => {
  it("strips directory components from a traversal attempt", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Windows\\system32\\cmd.exe")).toBe("cmd.exe");
  });

  it("strips leading dots so hidden files cannot be created", () => {
    expect(sanitizeFilename(".env")).toBe("env");
  });

  it("removes control characters", () => {
    expect(sanitizeFilename("re\u0000port\u001f.pdf")).toBe("report.pdf");
  });

  it("falls back to a safe default for an empty name", () => {
    expect(sanitizeFilename("...")).toBe("file");
  });

  it("keeps a normal filename intact", () => {
    expect(sanitizeFilename("Q3 Incident Report.pdf")).toBe(
      "Q3 Incident Report.pdf",
    );
  });

  it("rejects a traversal filename at validation time", () => {
    const result = validateUpload({
      ...base,
      filename: "../../../etc/hosts.csv",
      mimeType: "text/csv",
      head: TEXT_HEAD,
    });

    expect(result).toMatchObject({ ok: true, safeFilename: "hosts.csv" });
  });
});
