# CLAUDE.md

Guidance for working in this repository.

## What this project is

**AI Ops Copilot** — a single-workspace RAG knowledge assistant for IT operations
teams. Users upload operational documents; answers are generated **only** from
those documents, with citations.

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

4. **Refuse before spending a model call.** If no chunk clears `RAG_MIN_SCORE`,
   `answerQuestion` returns the refusal without invoking the chat provider.

5. **Secrets stay server-side.** Everything touching the DB or a provider
   imports `server-only`. No `NEXT_PUBLIC_` variable exists, and none should.

6. **Uploads are validated three ways** — extension, declared MIME type, and
   magic bytes must all agree. Storage keys are built from IDs
   (`{workspaceId}/{documentId}.{ext}`), never from the user's filename.

7. **Follow-ups are rewritten before they are embedded.** Retrieval searches
   the *standalone* form of a question (`src/lib/rag/rewrite.ts`). Passing
   history only to the answering model would leave retrieval matching against
   "what about for Sev-2?", which embeds almost no signal. `AnswerResult.searchQuery`
   records what was actually embedded.

8. **Evaluation scoring is deterministic, never model-graded.** A regression
   suite must return the same verdict for the same output, or you cannot
   distinguish a retrieval regression from judge variance. Cases that rules
   cannot decide return `null` and fall to human review — they are never
   guessed at.

## ⚠️ Prisma drops the pgvector index on every migration

Prisma cannot see raw-SQL indexes on `Unsupported()` columns, so **every**
`prisma migrate dev` emits:

```sql
-- DropIndex
DROP INDEX "DocumentChunk_embedding_hnsw_idx";
```

**Always delete that statement before applying.** It does not break
correctness, which is what makes it dangerous — it silently turns every vector
search into a sequential scan. Each migration since `20260804031124` also ends
with a `CREATE INDEX IF NOT EXISTS` guard that restores the index if an earlier
migration removed it. Keep adding that guard.

Verify after any migration:

```bash
docker compose exec -T postgres psql -U postgres -d ai_ops_copilot \
  -c "\di DocumentChunk_embedding_hnsw_idx"
```

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

## The RAG pipeline

```
question ─▶ rewrite (only if history) ─▶ embed ─▶ pgvector top-K
                                                      │
                    ┌─────────────────────────────────┤
                    │ nothing ≥ RAG_MIN_SCORE         │ else
                    ▼                                 ▼
                 REFUSE                    label S1..Sn ─▶ LLM ─▶ Zod
              (no model call)                                      │
                                                                   ▼
                                                     validate citations
                                            (unknown ⇒ dropped; none ⇒ refuse)
```

Retrieval is **dense single-stage** with cosine similarity (`<=>`,
`vector_cosine_ops`). No hybrid search, no re-ranking, no multi-query. That is
deliberate — it is the baseline the evaluation suite measures against. Do not
add retrieval complexity without a before/after run of `/admin/evaluations`.

A follow-up costs **two** chat calls (rewrite + answer); a first question costs
one. `needsRewrite()` short-circuits when there is no history.

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
