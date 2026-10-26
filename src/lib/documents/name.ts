/**
 * What a document is called wherever it is shown: the name a person gave it
 * (`Document.title`, which a person's edit owns and an AI pass may fill
 * before one), else the file's own name. One definition, so a renamed file
 * reads the same in the list, a task's documents, its sources, and chat.
 * Retrieval SQL spells the same rule as `COALESCE(NULLIF(title, ''), …)`.
 */
export function documentName(document: { title?: string | null; originalFilename: string }): string {
  return document.title?.trim() || document.originalFilename;
}
