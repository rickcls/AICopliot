# CLAUDE.md

Guidance for working in this repository.

## What this project is

**AI Ops Copilot** — a single-workspace RAG knowledge assistant for IT operations
teams. Users create project workspaces, upload operational documents into each
project, and receive answers generated **only** from the selected document
scope, with citations.

**This is a RAG workflow, not an autonomous agent.** Do not add multi-agent
orchestration, autonomous loops, external tool calling, ServiceNow (or similar)
integrations, or anything that modifies external systems. Every LLM call is a
single request/response inside a user-initiated action.

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript strict |
| Styling | Tailwind v4, local primitives in `src/components/ui.tsx` |
| ORM | Prisma 7 — **driver adapter required**, no Rust engine |
| Database | PostgreSQL 17 + pgvector 0.8.6 (Docker) |
| Auth | Auth.js v5 (`next-auth@beta`), Credentials + JWT sessions |
| Validation | Zod 4 — all API inputs and all model JSON output |
| Tests | Vitest 4 |
| Package manager | **npm** |

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest run — no DB, network, or API key needed
npm run db:up        # start Postgres+pgvector
npm run db:migrate   # prisma migrate deploy && prisma generate
npm run db:seed      # demo user: demo@example.com / demo-password-123
```

Prisma 7 does **not** run `generate` automatically after `migrate` — run it
explicitly (`npm run db:migrate` already chains both).

## Invariants — do not break these

These are the load-bearing rules. Each is covered by a test in `tests/`.

1. **Workspace isolation.** Every read and write is scoped by `workspaceId`.
   Single-record lookups use `findFirst({ where: { id, workspaceId } })` —
   **never** `findUnique({ where: { id } })`, so an ID from another workspace
   simply does not resolve. Routes call `requireWorkspace()` before any query.

2. **`ready` implies embeddings exist.** In `src/lib/ingest/pipeline.ts`, the
   chunk inserts and `status: 'ready'` happen in the **same** `$transaction`.
   Never set `ready` outside that transaction.

3. **The model cannot cite what it did not receive.** Retrieved chunks are
   labelled `S1..Sn` in the prompt; **real database IDs are never sent to the
   model.** Returned IDs are resolved through a server-side map and dropped if
   absent. An answer left with zero valid citations is downgraded to a refusal.

4. **Refuse before spending a model call.** A chunk must either clear the
   semantic `RAG_MIN_SCORE` or match the PostgreSQL full-text query. If neither
   retrieval path supplies evidence, `answerQuestion` returns the refusal
   without invoking the chat provider.

5. **Secrets stay server-side.** Everything touching the DB or a provider
   imports `server-only`. No `NEXT_PUBLIC_` variable exists, and none should.

6. **Uploads are validated three ways** — extension, declared MIME type, and
   magic bytes must all agree. Storage keys are built from IDs
   (`{workspaceId}/{documentId}.{ext}`), never from the user's filename.

7. **Projects scope knowledge; workspaces authorize access.** A `projectId`
   supplied by the client is never trusted by itself. Project lookup and
   document assignment use `findFirst({ where: { id, workspaceId } })` before
   writes. When a project is selected, both hybrid retrieval SQL paths filter
   `Document.projectId` inside the query. Deleting a project sets related
   document, conversation, and evaluation project IDs to null; it never deletes
   their business records.

## Architecture seams

Three abstractions exist so pieces can be swapped without touching call sites:

- **`src/lib/providers/`** — `EmbeddingProvider` / `ChatProvider`. Swapping
  models is an env change; swapping vendors is one new file.
- **`src/lib/storage/`** — `StorageProvider`. Local disk today; the S3 adapter
  is one new file implementing `put/get/delete`.
- **`runIngestion(documentId)`** in `src/lib/ingest/pipeline.ts` — takes only an
  ID and reads everything else from the DB and storage. **This is the seam for
  the planned S3 + SQS + Lambda migration.** A queue consumer calls the same
  function; the UI already polls for status, so nothing above it changes.

Prefer passing providers in as arguments (see `AnswerDeps`, `IngestionDeps`) so
tests can inject fakes rather than mocking modules.

## pgvector notes

`DocumentChunk.embedding` is `Unsupported("vector(1536)")`. Prisma deliberately
omits `Unsupported` fields from the generated client, so **all** vector reads and
writes use `$queryRaw` / `$executeRaw` with `toVectorLiteral()` from
`src/lib/db.ts`. This is expected, not a workaround.

The dimension is baked into the migration. Changing the embedding model to one
with a different dimension requires a **new migration and re-embedding every
chunk**.

Cosine distance is `<=>`; similarity is `1 - (a <=> b)`. The HNSW index uses
`vector_cosine_ops` and must match the operator used in queries.

## Hybrid retrieval notes

`src/lib/rag/retrieve.ts` runs workspace-scoped vector and PostgreSQL full-text
searches in parallel. `src/lib/rag/ranking.ts` merges their ranked candidates
with reciprocal-rank fusion; do not combine raw cosine similarity and
`ts_rank_cd` directly because their numeric scales are unrelated.

The semantic score remains `RetrievedChunk.score` so `RAG_MIN_SCORE` retains a
stable meaning. A positive lexical score is independently acceptable grounding
evidence because the full-text query requires every non-stopword query lexeme
to match. Both SQL paths must keep the workspace, ready-document, and embedding
guards inside their queries. The GIN expression index must use the same
`english` text-search configuration as the lexical query.

## Project workspace notes

`Project` is the user-facing knowledge container below `Workspace`. The project
detail route owns the focused workflow: upload documents, see only documents in
that project, and open chat with the project preselected. `/dashboard` remains
the cross-project document administration view for assigning or moving files.

`ChatConversation.projectId` and `EvaluationCase.projectId` preserve the scope
used for an answer. Changing project scope in the chat UI starts a fresh
conversation so messages from different document sets are never mixed.

## Conventions

- Small, readable functions; avoid abstractions with one implementation and no
  planned second one.
- Comments explain *why*, not *what*. Most code should need none.
- Pure logic (chunking, citation validation, upload validation) stays free of
  I/O so it is directly testable.
- Server components fetch initial data and pass it to client components as
  props — do not fetch on mount in an effect (React 19 lint forbids the
  resulting `setState`-in-effect).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
