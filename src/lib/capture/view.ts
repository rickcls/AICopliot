import type { getCapture } from "@/lib/capture/service";
import type {
  AddNotePayload,
  CitedLine,
  CreateTaskPayload,
  ProposalFlag,
  UpdateTaskPayload,
} from "@/lib/capture/validate";

/**
 * The shape a capture takes on its way to the browser: dates as ISO strings,
 * JSON columns typed by proposal kind. Shared by the routes and the pages so
 * a capture loaded on the server and one returned by POST render the same.
 */

type ProposalBase = {
  id: string;
  state: "pending" | "applied" | "dismissed";
  citations: CitedLine[];
  flags: ProposalFlag[];
  task: { id: string; title: string; projectId: string; projectName: string } | null;
  appliedTaskId: string | null;
  appliedCommentId: string | null;
  /** Where the applied task lives, for the "Open task" link. */
  appliedTaskProjectId: string | null;
};

export type CaptureProposalView =
  | (ProposalBase & { kind: "create_task"; payload: CreateTaskPayload })
  | (ProposalBase & { kind: "update_task"; payload: UpdateTaskPayload })
  | (ProposalBase & { kind: "add_note"; payload: AddNotePayload });

export interface CaptureView {
  id: string;
  source: "text" | "voice" | "document" | "email" | "whatsapp";
  body: string;
  status: "processing" | "ready" | "failed";
  errorMessage: string | null;
  localDate: string;
  documentId: string | null;
  documentName: string | null;
  createdAt: string;
  proposals: CaptureProposalView[];
}

type CaptureRow = NonNullable<Awaited<ReturnType<typeof getCapture>>>;

export function toCaptureView(row: CaptureRow): CaptureView {
  return {
    id: row.id,
    source: row.source,
    body: row.body,
    status: row.status,
    errorMessage: row.errorMessage,
    localDate: row.localDate.toISOString().slice(0, 10),
    documentId: row.documentId,
    documentName: row.document?.originalFilename ?? null,
    createdAt: row.createdAt.toISOString(),
    proposals: row.proposals.map(
      (proposal) =>
        ({
          id: proposal.id,
          kind: proposal.kind,
          state: proposal.state,
          payload: proposal.payload,
          citations: proposal.citations as unknown as CitedLine[],
          flags: proposal.flags as ProposalFlag[],
          task: proposal.task
            ? {
                id: proposal.task.id,
                title: proposal.task.title,
                projectId: proposal.task.projectId,
                projectName: proposal.task.project.name,
              }
            : null,
          appliedTaskId: proposal.appliedTaskId,
          appliedCommentId: proposal.appliedCommentId,
          appliedTaskProjectId: proposal.appliedTask?.projectId ?? null,
        }) as unknown as CaptureProposalView,
    ),
  };
}
