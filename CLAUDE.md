# CLAUDE.md

Guidance for working in this repository.

## What this project is

**ScopePilot — AI Requirements-to-Delivery Copilot** — a single-workspace
discovery and delivery assistant. Users create project workspaces, upload project
documents, extract cited draft *requirements* and cited draft *plans* for human
approval, trace agreed requirements to the work that delivers them, and ask
questions grounded in documents and approved live project records.

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

9. **Projects scope knowledge; workspaces authorize access.** A `projectId`
   supplied by the client is never trusted by itself — `requireProject()` in
   `src/lib/auth-guard.ts` resolves it with
   `findFirst({ where: { id, workspaceId } })` before any write. When a project
   is selected, both hybrid retrieval SQL paths filter `Document.projectId`
   inside the query.

   Deleting a project follows the record's own nullability, and the two rules
   must not be confused:
   - **`SET NULL`** for `Document`, `ChatConversation`, and `EvaluationCase`.
     Their `projectId` is nullable, so they survive as unassigned records.
     Removing an organizational container must not destroy uploaded knowledge
     or answer history.
   - **`CASCADE`** for `Requirement`, `Task`, `Milestone`, `ProjectRisk`, and
     `GenerationRun`. Their `projectId` is **not** nullable — a task with no
     project would be unreachable in every view, so orphaning is not an available
     outcome. The delete confirmation names these counts before it destroys them.

10. **Only official records enter operational reads.** `Task`, `Milestone`,
   `ProjectRisk`, and `TaskDependency` use the same source/review invariant:
   manual records are `manual + not_applicable + no generationRunId`; generated
   records are `ai_suggested` with a run and `draft | approved | rejected`.
   “Official” means manual/not-applicable or AI/approved. Always compose PM
   queries with `officialRecordWhere()` from `src/lib/pm/rules.ts`; drafts and
   rejections belong only in Review history.

11. **Generated plans are proposals, never silent writes.** Plan generation
   first creates an auditable `processing` run, uses opaque evidence labels,
   validates every item/citation/reference/date/edge, and atomically persists
   only surviving drafts. Editing, approval, and rejection happen through the
   Review API, record the human reviewer/time, and enforce milestone and
   dependency approval prerequisites in one transaction.

12. **Completion timestamps are transitions, not edit timestamps.** Entering
   task `done` or milestone `completed` sets `completedAt`; reopening clears it;
   unrelated edits preserve it. Weekly reports depend on this distinction.

13. **Project chat has two evidence families.** Global chat is document-only.
   Project chat always uses `project_combined`: document retrieval and official
   project-data selection run in parallel, live records are frozen with
   `observedAt`, and exact aggregate counts remain available even if the detail
   list is capped. History supplies wording only and is never evidence.

14. **A requirement carries two independent status axes.** `source` +
   `generationStatus` answer *did a human accept this record?* — identical to the
   delivery records, so `officialRecordWhere()` and the CHECK constraint apply
   unchanged. `status` (`draft | needs_clarification | validated | approved |
   rejected`) answers *is this agreed scope?* **Baselined scope requires both**:
   `baselinedRequirementWhere()` in `src/lib/pm/rules.ts` is the only definition,
   and coverage counts, chat grounding, and link targets all use it. A manual
   requirement is official the moment it is saved but still starts at `draft` —
   writing something down is not agreeing it. For AI rows the two axes are tied
   together by the pure `requirementGenerationStatusFor()`, never by hand.

   **The register deliberately lists drafts, which is an extension of invariant
   10 rather than a breach of it.** A draft task has no operational meaning, so
   it belongs only in Review history. A draft requirement — "we think they asked
   for this, unconfirmed" — *is* the working state a consultant acts on, and
   `needs_clarification` is the queue of things to take back to the client.
   Hence the register page and `GET /api/projects/[id]/requirements` are the only
   reads that omit the official predicate, and `PATCH /api/requirements/[id]` is
   the only item route that resolves rows without it. Every operational read
   still uses `baselinedRequirementWhere()`.

## ⚠️ Prisma drops the pgvector index on every migration

Prisma cannot see raw-SQL indexes on `Unsupported()` columns, so **every**
`prisma migrate dev` emits:

```sql
-- DropIndex
DROP INDEX "DocumentChunk_embedding_hnsw_idx";
```

Delete that statement before applying. It does not break correctness, which is
what makes it dangerous — it silently turns every vector search into a
sequential scan, with no error and no failing test.

**This is enforced, not remembered.** `prisma/ensure-vector-index.ts` runs after
every migration (chained into `db:migrate` and `db:migrate:dev`) and:

- recreates the extension and index if they are missing,
- **fails with a non-zero exit** if the index is absent or built with the wrong
  operator class — which breaks the `&&` chain rather than passing silently.

So forgetting to delete the DROP is now recoverable. Still delete it: the guard
is a safety net, not a licence to skip the step, and rebuilding an HNSW index on
a large table is slow.

Run it standalone any time:

```bash
npm run db:ensure-index
```

The operator class in that script must match the operator in
`src/lib/rag/retrieve.ts` (`<=>` ⇒ `vector_cosine_ops`). If they diverge,
Postgres ignores the index instead of erroring — which is exactly why the script
checks `indexdef` rather than merely checking that the index exists.

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

## The grounding and generation pipelines

```
selected documents ─▶ bounded context (≤48 chunks) ─▶ label S1..Sn
       └──────────────────────────────────────────────▶ LLM JSON
                                                        │
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                              validate citations + graph    validate citations
                                          │                           │
                                          ▼                           ▼
                        draft plan ─▶ Review page ─▶ official   draft requirements
                                                                      │
                                                                      ▼
                                                      register review ─▶ baselined
                                                                      │
                                                        RequirementLink ─▶ coverage

question ─▶ rewrite ─┬─▶ hybrid document retrieval ───────────────┐
                     └─▶ deterministic official project snapshot ┤
                                                                  ▼
                                                  opaque source labels ─▶ LLM
                                                                  │
                                                                  ▼
                                                validate citation families
                                                (none ⇒ grounded refusal)

official records ─▶ deterministic UTC weekly snapshot + health ─▶ LLM narrative
                                                              └─▶ saved report run
```

Retrieval is **hybrid**: dense cosine similarity (`<=>`, `vector_cosine_ops`)
fused with PostgreSQL full-text via reciprocal-rank fusion
(`src/lib/rag/ranking.ts`). Do not combine raw cosine and `ts_rank_cd` directly
— their scales are unrelated. Measure changes with `/admin/evaluations`.

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
that project, and open chat with the project preselected. `/documents` is the
cross-project administration view for assigning or moving files.

`ChatConversation.projectId`, `groundingScope`, and the equivalent evaluation
fields preserve the scope used for an answer. Changing project/scope in the chat
UI starts a fresh conversation so messages from different evidence sets are
never mixed. `ChatMessage.groundingSourceIds` and saved public citations retain
the frozen live snapshots used at answer time.

## Requirements register notes

The register is the discovery half of the product: what the client asked for,
before and independently of the work created to deliver it. Read invariant 14
first — the two-axis model is the thing everything else here depends on.

**Extraction mirrors plan generation rather than forking it.**
`src/lib/generation/requirements-{prompt,validate,service}.ts` reuse
`resolveDocumentCitations`, `buildLabelledContext`, the `processing → draft →
failed` audit lifecycle, the single JSON repair attempt, and the
provider-resolved-after-the-run-row rule. The only genuinely new piece is
`REQUIREMENTS_QUERIES`, which is why `selectDocumentContext(…, queries)` takes
its probes as an argument and `selectPlanContext` is now a thin wrapper.

**The prompt's most important rule is rule 4: do not infer unstated specifics.**
"Must be secure" yields a `low`-confidence requirement at that level of detail,
never an invented MFA control or retention period. Naming a specific the client
never stated converts an open question into a false agreement — which is exactly
the failure the register exists to prevent. Unresolved detail goes in
`assumptions`; an unstated verification stays `null` rather than being invented.

**`sequence` is an integer, `REQ-007` is a rendering.** `formatRequirementCode()`
in `rules.ts` is the only place the display format lives. Sequences are handed out
inside the same transaction as the insert, and `@@unique([projectId, sequence])`
is what stops two concurrent batches colliding — the manual create route retries
once on `P2002`.

**`RequirementLink` has three nullable foreign keys, not an opaque `targetId`.**
A bare id has no referential integrity, so deleting a task would leave a link that
coverage queries still count. `RequirementLink_exactly_one_target` is a
hand-written CHECK because Prisma cannot express it. Only *official* records may
be linked, so a coverage count can never be satisfied by a draft proposal. Phase 1
uses only the task edge; the milestone and risk edges exist so the traceability
matrix needs no migration.

Approved requirements are a chat evidence family labelled `Q1..Qn` (`R` was
already risk). The project snapshot carries exact requirement counts including
uncovered and uncovered-must, so *"which Must-have requirements have no task?"*
is answerable without the detail list being complete.

**`requirements-panel.tsx` is a scan-first list, not a card feed.** The first
version rendered every field of every record — five badges, four stacked
labelled sections, and a full-size `<select>` per row — at roughly 270px each,
so a 19-requirement extraction was 5,000px of unscannable scrolling and the
description wrapped into a ~30% column while half the row sat empty. Rules that
keep it readable:

- **One line per requirement, expanded on demand.** Collapsed rows carry only
  code, title, priority, and status; everything else lives in the expansion.
- **Badges mark exceptions, not fields.** `warningsFor()` surfaces `no task`,
  `no criteria`, and `low confidence`. Badging every field means nothing stands
  out — `confidence: high` on all 19 rows was pure noise. MoSCoW uses weight
  rather than colour, so only `must` is loud.
- **The expanded body is a two-column `<dl>`**, which gives the prose one wide
  measure instead of four narrow ones.
- **Bulk review is first-class.** Reviewing an extraction is the page's purpose,
  so selection plus a batch status bar exists rather than 19 dropdowns. It
  includes *Back to draft*: without an undo, one mis-aimed batch approval could
  only be reversed a row at a time. Each item is still a separate PATCH, so the
  optimistic-concurrency check applies per row and one stale row fails alone.
- **The row wraps its metadata below `sm`.** At 375px the fixed-width badges
  left ~60px for the title, truncating every row to "Evalua…".
- Extraction collapses once the register has content — it is a setup step, not
  something you look at while reviewing.

## Project management notes

`/projects/[id]` has sections — Overview, Requirements, Tasks, Timeline,
Documents, Risks, Review, and Reports — built as nested routes under a shared
`layout.tsx`. Requirements comes before Tasks because discovery precedes
delivery. Each
is its own server page fetching only its own data. Layouts cannot pass data to
children and do not re-render, so the project lookup goes through `getScopedProject` in
`src/lib/pm/project.ts`, wrapped in React `cache` so the layout and the page
share one query.

**`src/components/app-sidebar.tsx` is the only navigation, and it is always
visible.** It holds global links and, for the project you are currently in, its
sections — derived from `usePathname`, because the layout rendering it does not
re-render on navigation. There is deliberately no tab strip: two nav systems
disagree about where you are, and no toggle: below `md` it narrows to a 56px
icon rail instead of hiding. Labels are hidden with CSS (`hidden md:inline`)
rather than conditionally rendered, so the markup is identical at every
breakpoint and cannot cause a hydration mismatch.

The app shell is full width; the old `max-w-5xl` cap is what squeezed five board
columns into ~180px each. Prose pages (`/chat`, `/documents/[id]`) opt back out
with their own `max-w-*`, because text gets harder to read as it widens.

**Routes:** `/dashboard` is the workspace summary only, and `/documents` is
cross-project document administration. They were one page; splitting them is why
the sidebar entry labelled "All Documents" leads to documents and nothing else.
`/projects/[id]/documents` remains the project-scoped library.

**All date and status logic lives in `src/lib/pm/rules.ts` and is pure.**
Overdue, blocked, due-in-7-days, active-project, and timeline bucketing each have
exactly one definition, and the `*Where` builders take `workspaceId` first
because no query may omit it. Do not retype these predicates inline — a card's
count and the list beneath it must come from the same filter.

Dates are compared at **UTC day** granularity. `<input type="date">` submits
`YYYY-MM-DD`, which parses as UTC midnight; a task due today must not read as
overdue because the viewer is west of UTC. Render date-only values with
`formatDay` (UTC-pinned), never `formatDate` — the latter shows local time and
would disagree with the overdue calculation west of UTC.

`src/lib/pm/gantt.ts` is the other pure module: it turns dated items into bar
offsets and widths as **percentages**, so the chart is plain CSS with no
measurement, no layout effects, and no charting dependency. A bar covers its
final day (hence the `+1`), a same-day item is clamped to a minimum width so it
stays visible, and today is folded into the range so its marker is never
off-screen. A task with a due date but no `startDate` has a deadline without a
duration and renders as a point, not an invented span.

The board's drag-and-drop uses native HTML5 drag events — one status change does
not justify a dependency. Two rules: the drop handler reads the task id from
`dataTransfer`, **not** from React state (state set in `dragstart` may not be
committed when `drop` runs), and the status `<select>` in the detail panel stays
as the keyboard-accessible equivalent, so the board is never drag-only. The move
is optimistic and rolls back on failure.

The Tasks page also has a Board/List switch. Both views render from the same
client-side `tasks` state in `src/components/task-board.tsx`, so creating,
editing, deleting, or changing a status stays in sync without a second fetch.
The List view is a compact table with Jira-style quick filters for All, Backlog,
To do, In progress, Blocked, and Done; filter counts are derived from the current
task state and must update with it. The whole list row is mouse- and
keyboard-activated and opens the same `TaskDetail` slide-over used by board
cards, including its Edit action. The table keeps task, status, priority,
assignee, and due date visible at the normal project viewport, shows estimate
on wider screens, and scrolls horizontally when the viewport is narrower.

Update schemas (`updateTaskSchema` and friends) are built from a field map with
**no `.default()`**, because `.partial()` does not strip defaults — a defaulted
field would materialise on a PATCH and silently overwrite a value the caller
never mentioned. For the same reason `optionalText` keeps `undefined` (leave
alone) distinct from `null`/`""` (clear it).

Collection routes are nested under the project (`POST /api/projects/[id]/tasks`)
because creation needs project authorization; item routes are flat
(`PATCH /api/tasks/[id]`) because the row carries its own `projectId` and the
workspace is the security boundary. This mirrors the existing `/api/documents`
split.

Plan generation lives at `/api/projects/[id]/generation-runs`; its Review action
is nested under both project and run so every lookup can constrain workspace,
project, run, source, and draft state. Weekly reports use
`/api/projects/[id]/status-reports` for project history/creation and the flat
`/api/status-reports/[id]` read only after a workspace-scoped lookup.
Requirements extraction is `/api/projects/[id]/requirement-runs` and has no
separate review route, because review is a status PATCH on the record itself.

## ⚠️ A new `GenerationRunType` value needs its own migration file

Postgres refuses to *use* an enum value in the transaction that added it, and
Prisma runs each migration file in one transaction. `20260806000000_requirements_run_type`
therefore contains only the `ALTER TYPE … ADD VALUE`, and everything referencing
`'requirements'` — including the partial unique index that enforces one active
extraction run per project — lives in `20260806000100_requirements_register`.

The earlier `ALTER TYPE "GenerationRunStatus" ADD VALUE 'processing'` got away
with a single file only because nothing in that migration referenced the new
value. Do not read it as precedent.

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
