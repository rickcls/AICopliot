import type { Translate } from "@/lib/i18n/translate";
import { asUploadable, mailFileErrorKey } from "@/lib/mail/document";

/**
 * Uploads a file into a project and indexes it, for a question that should be
 * answered from it straight away — attached in the assistant or in Ask
 * documents. The ordinary upload route and its three-way check, then the
 * ordinary process route, so the file is a document like any other: listed,
 * linkable, and searchable later. Labelling runs afterwards and is not waited
 * on; an email is read in the browser first (`asUploadable`).
 */

export type UploadFailure =
  | { reason: "mail"; key: "capture.mailFileTooLarge" | "capture.mailFileEmpty" }
  | { reason: "upload" | "index"; detail: string | null };

export type UploadResult =
  | { ok: true; id: string; name: string }
  | ({ ok: false; filename: string } & UploadFailure);

export async function uploadAndIndex(chosen: File, projectId: string): Promise<UploadResult> {
  let file: File;
  try {
    file = await asUploadable(chosen);
  } catch (caught) {
    const key = mailFileErrorKey(caught);
    if (key) return { ok: false, filename: chosen.name, reason: "mail", key };
    return { ok: false, filename: chosen.name, reason: "upload", detail: null };
  }

  const form = new FormData();
  form.append("file", file);
  form.append("projectId", projectId);
  const uploaded = await fetch("/api/documents", { method: "POST", body: form }).catch(() => null);
  const data = (await uploaded?.json().catch(() => ({}))) ?? {};
  if (!uploaded?.ok || !data.id) {
    return { ok: false, filename: chosen.name, reason: "upload", detail: data.error ?? null };
  }

  // Indexing runs inside this request; the answer needs the passages to exist.
  const processed = await fetch(`/api/documents/${data.id}/process`, { method: "POST" })
    .then((response) => response.json())
    .catch(() => ({ status: "failed" }));
  if (processed.status !== "ready") {
    return { ok: false, filename: chosen.name, reason: "index", detail: processed.error ?? null };
  }
  void fetch(`/api/documents/${data.id}/label`, { method: "POST" }).catch(() => undefined);
  return { ok: true, id: data.id, name: file.name };
}

/** Uploads one at a time, reporting each as it finishes, so a long batch shows progress. */
export async function uploadAllAndIndex(
  files: readonly File[],
  projectId: string,
  onProgress?: (done: number, total: number, current: string | null) => void,
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (const [index, file] of files.entries()) {
    onProgress?.(index, files.length, file.name);
    results.push(await uploadAndIndex(file, projectId));
  }
  onProgress?.(files.length, files.length, null);
  return results;
}

/** What to tell the person about one file that did not make it. */
export function uploadFailureMessage(result: Extract<UploadResult, { ok: false }>, t: Translate): string {
  if (result.reason === "mail") return `${result.filename}: ${t(result.key)}`;
  if (result.reason === "index") {
    return result.detail
      ? t("tasks.documents.processFailedReason", { filename: result.filename, reason: result.detail })
      : t("tasks.documents.processFailed", { filename: result.filename });
  }
  return t("documents.uploadFailed", { name: result.filename, error: result.detail ?? t("common.couldNotReach") });
}
