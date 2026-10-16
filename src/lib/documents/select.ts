/**
 * The fields a document row shows, shared by the list API and both document
 * pages so a row loaded on the server and one refetched while polling render
 * the same.
 */
export const documentRowSelect = {
  id: true,
  originalFilename: true,
  sizeBytes: true,
  status: true,
  errorMessage: true,
  chunkCount: true,
  createdAt: true,
  projectId: true,
  project: { select: { name: true } },
  title: true,
  summary: true,
  docType: true,
  tags: true,
  suggestedProjectId: true,
  suggestedProject: { select: { name: true } },
  labelledAt: true,
} as const;

export interface DocumentRow {
  id: string;
  originalFilename: string;
  sizeBytes: number;
  status: "uploaded" | "processing" | "ready" | "failed";
  errorMessage: string | null;
  chunkCount: number;
  createdAt: string;
  projectId: string | null;
  project: { name: string } | null;
  title: string | null;
  summary: string | null;
  docType: string | null;
  tags: string[];
  suggestedProjectId: string | null;
  suggestedProject: { name: string } | null;
  labelledAt: string | null;
}

export function toDocumentRow(row: {
  createdAt: Date;
  labelledAt: Date | null;
} & Omit<DocumentRow, "createdAt" | "labelledAt">): DocumentRow {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    labelledAt: row.labelledAt ? row.labelledAt.toISOString() : null,
  };
}
