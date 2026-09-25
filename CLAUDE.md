# CLAUDE.md

Guidance for working in this repository.

## What this project is

**ScopePilot — AI Requirements-to-Delivery Copilot** — for project managers and
business analysts (consultants and small teams) who turn client documents into
agreed scope. **The core product is requirements discovery:** upload client
documents → extract cited draft requirements → review them → take open questions
back to the client → agree → hand over a sign-off document. Grounded Q&A over
the documents supports every step.

**Delivery is an optional layer, off by default per project**
(`Project.deliveryEnabled`): tasks, timeline, risks, AI draft plans, and weekly
reports. It exists for teams who run delivery here; everyone else exports the
agreed requirements to the tool they already use. **Do not grow the delivery
layer into a Jira/Asana competitor** — new work should make the discovery loop
better, and anything that is not part of it belongs behind the switch.

**`deliveryEnabled` gates navigation, never data or security.** It decides which
tabs show and which delivery widgets render. Hidden routes still resolve (with a
notice and a way to turn the tools on), still enforce workspace scoping, and
project chat still grounds on official records whatever the switch says.

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
| Database | PostgreSQL 17 + pgvector 0.8.6. Docker locally; Neon on Vercel |
| Auth | Auth.js v5 (`next-auth@beta`), Credentials + JWT sessions |
| Validation | Zod 4 — all API inputs and all model JSON output |
| Tests | Vitest 4 |
| Package manager | **npm** |

## Commands

```bash
npm run dev          # dev server
npm run build        # prisma generate && next build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest run — no DB, network, or API key needed
npm run db:up        # start Postgres+pgvector
npm run db:migrate   # migrate deploy, prisma generate, then the vector-index check
npm run db:seed      # demo user: demo@example.com / demo-password-123
```

Prisma 7 does **not** run `generate` automatically after `migrate` — run it
explicitly (`npm run db:migrate` and `npm run build` already chain it). The
generated client is gitignored (`/src/generated`), so a Vercel build has no
client until that step runs.

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
 a task status whose category is `done`, or a milestone `completed`, sets
 `completedAt`; reopening clears it; unrelated edits preserve it. Weekly
 reports depend on this distinction.

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
- **`src/lib/storage/`** — `StorageProvider`. Local disk when
  `BLOB_READ_WRITE_TOKEN` is unset; Vercel Blob (private, same
  `{workspaceId}/{documentId}.{ext}` key) when it is set. An S3 adapter is
  still one new file implementing `put/get/delete`.
- **`runIngestion(documentId)`** in `src/lib/ingest/pipeline.ts` — takes only an
  ID and reads everything else from the DB and storage. **This is the seam for
  the planned S3 + SQS + Lambda migration.** A queue consumer calls the same
  function; the UI already polls for status, so nothing above it changes.

Prefer passing providers in as arguments (see `AnswerDeps`, `IngestionDeps`) so
tests can inject fakes rather than mocking modules.

## Production on Vercel

The live app is [ai-copliot.vercel.app](https://ai-copliot.vercel.app), built
from `main` on `rickcls/AICopliot`. Local `npm run dev` stays on Docker and
disk. Production switches on env vars. Do not commit `.env`; `.vercelignore`
keeps it out of CLI deploys, because a copied local `DATABASE_URL` once made
production open `127.0.0.1`.

**Connection strings are resolved in `src/lib/database-url.ts`, not read ad hoc.**
The Neon integration on this project is named Storage, so Vercel injects
`Storage_DATABASE_URL` (pooled) and `Storage_DATABASE_URL_UNPOOLED` (direct).
Requests use the pooled URL. `npm run db:migrate` and `db:ensure-index` prefer
`DIRECT_URL`, then the unpooled Storage name, so `CREATE INDEX` does not run
through Neon’s pooler. A `DATABASE_URL` whose host is `localhost`, `127.0.0.1`, or `::1` loses to a
hosted URL when both are present. The production `pg`
pool is capped at four connections per serverless instance — not one, because a
single connection serialises every `Promise.all` in a page.

**Functions run in `sin1` because Neon is in `ap-southeast-1`.** `vercel.json`
pins the region. Without it Vercel defaults to `iad1`, every query crosses the
Pacific (~200ms), and a page making thirty reads takes seconds. If the database
ever moves, move the region with it.

`prisma/ensure-vector-index.ts` forces IPv4 before it connects. On a network
that advertises IPv6 but cannot route it, the check otherwise times out with an
empty `AggregateError` after the migrations have already succeeded.

Chat, document processing, plan generation, requirement extraction, and weekly
reports export `maxDuration = 60`, the Hobby ceiling. A large PDF needs a
higher limit on Pro. The upload screen already polls and can retry a document
left `failed`.

Signed-in `/` redirects to `/dashboard`. It opens on the **discovery inbox** —
requirements to review and questions for clients, per project — and renders its
delivery half only when some project has delivery tools on, listing only those
projects. The delivery half lists overdue, due-within-7-days
(`dueSoonTaskWhere`), and blocked tasks. Each row opens
`/projects/{projectId}/tasks?task={taskId}`, and `TaskBoard` opens `TaskDetail`
when that id is in the loaded tasks. Do not point those rows at the bare
project list. Below the lists, `getProjectHealthRows()` in `src/lib/pm/summary.ts`
builds one line per project from grouped counts (a fixed handful of queries
however many projects exist), using the same predicates as each project's
Overview so the two pages cannot disagree. Its badges deep-link to the filtered
rows they count. With zero projects the page shows only the empty state.

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

**Re-extraction adds only what is new (rule 12, `requirements-v2`).** A
consultant uploads meeting notes every week, so each run receives the register's
existing titles as `E1..En` — titles only, never IDs, for the same reason sources
are `S` labels — rejected ones included so a turned-down requirement does not
come back. `validateRequirements(…, existingTitles)` is the deterministic
backstop: it drops a proposal whose `requirementTitleKey()` (case, punctuation,
and spacing ignored; wording not) matches an existing title. Keep that match
strict — a fuzzy one would silently drop a genuinely new obligation, and a missed
requirement costs more than a duplicate someone rejects in one click. A run with
nothing new fails with that explanation, not "no supported requirements".

**Status labels are written for the job, not the model.** `src/lib/pm/labels.ts`
is the only place they live: `draft` → *To review*, `needs_clarification` → *Ask
client*, `validated` → *Validated*, `approved` → *Agreed*, `rejected` →
*Rejected*. Change copy there; never rename an enum value for wording. The
Overview's single "Next step" comes from the pure `nextDiscoveryStep()` in
`src/lib/pm/discovery.ts` (upload → wait for indexing → extract → review →
clarify → agree → sign off); earlier steps win, because reviewing drafts is what
produces the client questions.

**Client packs are the hand-off.** `buildPack("questions" | "signoff", rows)` in
`requirements-export.ts` builds each pack once as data; the export route renders
it as Markdown (`?format=md&pack=…`) and `/print/requirements/[projectId]` as
HTML. That page sits **outside** the `(app)` group so no shell needs hiding —
what is on screen is what prints, and "Save as PDF" is the delivery mechanism, no
integration. The questions pack asks the recorded `assumptions` and never invents
a question's specifics (rule 4 again); the sign-off pack is agreed scope only,
Must first. The dark palette is `@media screen` only, so print is always dark
text on white.

**`sequence` is an integer, `REQ-007` is a rendering.** `formatRequirementCode()`
in `rules.ts` is the only place the display format lives. Sequences are handed out
inside the same transaction as the insert, and `@@unique([projectId, sequence])`
is what stops two concurrent batches colliding — the manual create route retries
once on `P2002`.

**`RequirementLink` has three nullable foreign keys, not an opaque `targetId`.**
A bare id has no referential integrity, so deleting a task would leave a link that
coverage queries still count. `RequirementLink_exactly_one_target` is a
hand-written CHECK because Prisma cannot express it. Only *official* records may
be linked, so a coverage count can never be satisfied by a draft proposal. All
three edges are in use: the register links tasks, milestones, and risks through
one `LinkEditor`, so the three cannot drift apart. **Coverage still counts the
task edge only** — `uncoveredRequirementWhere` and chat grounding ask "does
work exist to deliver this?", and a milestone or risk link does not answer that.

**Traceability reads in both directions.** `tracedRequirementsSelect` in
`src/lib/pm/select.ts` rides on `taskSelect`, `milestoneSelect`, and
`riskSelect` as `requirementLinks`, so task detail, milestone rows, and risk rows
show the requirements they deliver (`traced-requirements.tsx`). Rejected
requirements are excluded; drafts are kept, because the register treats them as
the working state. Each chip opens `/projects/{id}/requirements?req={id}`, which
expands and scrolls to that row.

**The Matrix view is the register's second view, not a second page.** It renders
the register's *current filtered rows*, so a search narrows both views alike.
Delivery state comes from the pure `deliveryState()` in
`src/lib/pm/traceability.ts`: `no_task`, `planned` (no linked task done),
`partial`, `delivered` (every linked task done). Two rules:

- **States key off `TaskStatusCategory`, never a column label.** A category
  cannot tell Backlog from In progress, so no state claims to.
- **Delivery is claimed only for approved scope.** A draft with a finished task
  linked is still a draft; showing it as "Delivered" would read as agreed.

**Exports** (`GET /api/projects/[id]/requirements/export?format=csv|md`) use the
same register rows (drafts included — the export is what goes back to the client
to confirm) and the same `deliveryState()`. The pure formatters live in
`src/lib/pm/requirements-export.ts`. CSV cells beginning `= + - @` are prefixed
with `'`, because they hold text lifted from client documents and a spreadsheet
would otherwise execute them. The file carries a BOM and CRLF so Excel on Windows
opens it intact.

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

**These rules are the house pattern for every record list, not a quirk of the
register.** Risks and milestones were the same shape of mistake — a risk rendered
its description, mitigation, milestone, a Sources block with full excerpts, and a
`<select>` plus two buttons, so five risks were ~1,350px of scrolling. Both now
collapse to one line and expand into the same two-column `<dl>`. When you add a
list, follow it: **one line per record, exceptions badged rather than fields,
prose in the expansion.**

The shared pieces live in `src/components/ui.tsx` so the lists cannot drift
apart again: `SectionHeader` (every panel had grown its own, at three different
heading weights), `Field` (the `<dl>` pair — a fragment, because a wrapper would
make each pair one grid cell and collapse the two columns) inside
`DescriptionList` (the grid; label width is its only knob), `Avatar`, and badge
tones carrying a `ring-inset` so a pale pill still has an edge on a white row.
Also there, and to be reused rather than re-typed:

- `buttonClasses()` / `LinkButton` — a navigation styled as a button stays an
  `<a>`. Fourteen links had hand-copied button classes at three heights.
- `StatCard` (a zero renders neutral whatever its tone) and `ProgressBar` (fed
  by `percentOf` from `progress.ts`, never a raw `Math.round`).
- `FilterChip` (`aria-pressed` carries the state), `SearchField`, and `CHECKBOX`.

**The Review page follows the same pattern.** Proposals were a card each with
every field a live input; they are now one line (title, the facts that decide
approval, a source count, inline approve/reject) expanding into the editor and
sources. Decided items expand into read-only values, not disabled inputs.

Two devices earn their keep in dense rows. **Priority is a coloured flag, not a
badge** — next to a status pill, two same-shaped pills compete for one glance,
and `low` is deliberately near-invisible because the column exists to find the
urgent rows. **A risk's impact and likelihood collapse to one chip coloured by
whichever is worse**; that is a rule for picking a colour, not a new severity
scale, and both levels stay named in the chip and again in the expansion.
Wherever colour replaces a word, the word goes to `sr-only` — see the flag on
`task-card.tsx`.

## Project management notes

`/projects/[id]` has three core sections in workflow order — **Overview,
Documents, Requirements** — and, when `deliveryEnabled`, five delivery sections:
**Tasks, Timeline, Risks, Plan** (route `/review`; renamed because the tab is
where a plan is generated, not merely reviewed) **and Reports**. They are nested
routes under a shared `layout.tsx`. Each
is its own server page fetching only its own data. Layouts cannot pass data to
children and do not re-render, so the project lookup goes through `getScopedProject` in
`src/lib/pm/project.ts`, wrapped in React `cache` so the layout and the page
share one query.

**Navigation is split by question: the sidebar picks the project, the tab strip
picks the section.** `src/components/app-sidebar.tsx` holds global links and a
flat project list; `src/components/project-tabs.tsx` renders the sections
inside the project layout. Both read `usePathname`, because the layouts
rendering them do not re-render on navigation.

The sections used to nest under the active project in the sidebar, on the
argument that one nav cannot contradict itself. In practice one control was
answering two questions, and the resulting tree was tall enough to slide under
its own footer. Splitting them keeps that guarantee — there is still exactly one
place that says which project and one that says which section — so **do not
re-add section links to the sidebar, and do not add a second project switcher to
the tab strip.**

Neither is behind a toggle. Below `md` the sidebar narrows to a 56px icon rail
instead of hiding, with labels hidden by CSS (`hidden md:inline`) rather than
conditionally rendered, so the markup is identical at every breakpoint and
cannot cause a hydration mismatch. The tab strip scrolls sideways rather than
wrapping — a two-row strip reads as two groups and hides which row you are on —
and an effect scrolls the active tab into view with `scrollIntoView({ block:
"nearest", inline: "nearest" })`, so landing on Reports at 375px does not show a
strip with no visible selection. Both alignments are `nearest` so a tab already
on screen causes no scroll at all.

The tabs are links with `aria-current`, **not** an ARIA tablist: each one is a
real navigation to a separate route, and there is no tabpanel, so tablist markup
would promise assistive technology a widget that does not exist.

The app shell is full width; the old `max-w-5xl` cap is what squeezed five board
columns into ~180px each. Prose pages (`/chat`, `/documents/[id]`) opt back out
with their own `max-w-*`, because text gets harder to read as it widens.

**Routes:** `/dashboard` is the morning inbox (overdue, due soon, blocked) plus
the workspace counts, and `/documents` is cross-project document
administration. They were one page; splitting them is why
the sidebar entry labelled "All Documents" leads to documents and nothing else.
`/projects/[id]/documents` remains the project-scoped library.

**The Overview leads somewhere.** Each stat card opens the filtered rows it
counts (`/tasks?filter=overdue`, `/requirements?filter=gaps`, …), overdue and
blocked rows open the task itself, and a "waiting on a decision" banner counts
`undecidedRequirementWhere` and `pendingPlanRunWhere` from `rules.ts`.

**List filters live in `src/lib/pm/filters.ts` and are pure.** Task quick
filters (`overdue`, `due_soon`, `blocked`, `mine`, `unassigned`) call
`isOverdue`/`isDueWithinDays` rather than restating them, so a quick-filter
count agrees with the server count on the Overview. Filters only narrow rows the
page already loaded — they never widen a read past the official records. One
filter bar serves both board and list, so switching view keeps the same rows.
`?filter=` is parsed by `parseTaskQuickFilter` / `parseRegisterFilter`, which
live in that module rather than in the client panels: a server page cannot call
a function exported from a `"use client"` file. `TaskBoard` takes `nowIso` from
the server for the same hydration reason `ProjectTimeline` does. Risks default
to highest exposure first (`sortRisks`); exposure orders the list and is never
shown as a number, so it does not become a severity scale of its own.

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

`src/lib/pm/calendar.ts` and `src/lib/pm/progress.ts` are the other two pure
modules, and both exist for the Timeline page.

**The Timeline is a progress rollup plus one chart in two views.** It replaced a
Gantt over three Overdue/Next-7-days/Later lists that restated the bars they sat
under. `TimelineProgress` answers "how are we doing" in numbers;
`ProjectTimeline` toggles Gantt (duration) against a month calendar (deadlines).
The rules that keep it honest:

- **`countProgress` reuses `isOverdue`/`isDueWithinDays` rather than retyping
  them.** A headline count disagreeing with the bar beneath it is worse than no
  count, because a reader cannot tell which is wrong. `overdue`, `dueSoon`, and
  `undated` partition the open records; `atRisk` is a deliberately overlapping
  second axis, so one late blocked task reads as both.
- **The percentage never rounds onto an endpoint it has not reached.** 199/200 is
  99%, not a 100% sitting beside unfinished work, and 1/200 is 1%, not a 0% that
  denies finished work. A zero count renders grey whatever its tone — "0 overdue"
  in red is an alarm for good news.
- **The calendar is a *deadline* calendar, and Monday-first.** Each item sits on
  its due or target date only; drawing a multi-day task across every cell it
  touches needs week-by-week row packing and buries the dates that need
  attention. Duration is what the Gantt view is for. It renders every item in a
  cell rather than capping with "+3 more", because the view is read-only and a
  hidden item could never be revealed.
- **The grid is built with `Date.UTC`/`getUTC*` throughout.** Local getters would
  file a 1 August deadline in the July cell west of UTC and disagree with
  `isOverdue`. Weeks are always seven cells so the grid cannot go ragged.
- **`initialCalendarMonth` opens on a month with content.** A project entirely in
  the future would otherwise open on an empty grid and look like it had no work,
  so it falls back to the nearest dated month, preferring the future on a tie.
- **`ProjectTimeline` takes `nowIso` from the server** instead of calling
  `Date.now()`. It is a client component, so overdue, the today marker, and
  today's cell would otherwise be computed from a different instant at hydration
  than at render and disagree across a day boundary. Both views derive from the
  same `rows`, so switching view or month never refetches.

The board's drag-and-drop uses native HTML5 drag events — one status change does
not justify a dependency. Two rules: the drop handler reads the task id from
`dataTransfer`, **not** from React state (state set in `dragstart` may not be
committed when `drop` runs), and the status `<select>` in the detail panel stays
as the keyboard-accessible equivalent, so neither view is drag-only. The list
uses a grip handle for the same reason a whole-row drag would fight the
click-to-open row. The move is optimistic and rolls back on failure.

**Task columns are per-project (`ProjectTaskStatus`), not a global enum.**
New projects are seeded with the classic five (Backlog → Done). Users can add
or remove columns via the Statuses control; at least one `open` and one `done`
must remain, and a column with tasks cannot be deleted until they are moved.
Semantics — overdue, completion timestamps, blockers, reports — key off
`TaskStatusCategory` (`open | blocked | done`), never the label. Plan generation
still emits the classic keys and maps them onto the project's rows by `key`.
Each column/group still has an Add that seeds `emptyDraft(statusId)`.

The Tasks page also has a Board/List switch. Both views render from the same
client-side `tasks` state in `src/components/task-board.tsx`, so creating,
editing, deleting, or changing a status stays in sync without a second fetch.
The List view keeps the Jira-style quick filters for the project's statuses;
filter counts are derived from the current task state and must update with it.
The whole list row is mouse- and keyboard-activated and opens the same
`TaskDetail` slide-over used by board cards, including its Edit action. A
`?task=` search param initializes that panel, which is how the dashboard opens
a specific task. An id that is not in `initialTasks` is ignored.

**The list is grouped by status, in board order, and the group header is the
only place the status is written.** Filters and groups are different axes and
coexist: a filter narrows which rows exist, a group organises the ones that
survive. Two consequences to preserve:

- **Every column carries a width and none may be hidden by a media query.** The
  table is `table-fixed` so a long title truncates instead of forcing the table
  wider, and the group header spans a literal `colSpan`. A column hidden below a
  breakpoint leaves a phantom column behind that silently takes its width out of
  the Task column — which is what starved the title to ~170px and truncated
  every row to "Identify appl…". Below `min-w-[760px]` the whole table scrolls
  sideways instead.
- **Empty groups stay, and the per-row Status column is gone.** The list is a
  drop target and an Add surface the way the board is, so an empty Done group
  you can drop into earns its heading. A status badge on every row under a
  heading that already says it would be a column of identical pills. The
  coloured dot at the row start keeps the status legible for a row read on its
  own.

**Creating and editing a task is a modal, built on `src/components/modal.tsx`.**
It was an inline `Card` that pushed the board down the page, which meant the
thing you were describing scrolled out of sight while you typed. `Modal` uses
the native `<dialog>` and `showModal()` for the same reasons `confirm-dialog.tsx`
does — the browser supplies the focus trap, Escape, background inertness, and
top-layer painting, and the top layer is what clears the sticky `z-30` sidebar
without a z-index arms race. Three rules that are easy to undo by accident:

- **A backdrop click must not close it.** That is the deliberate difference from
  the confirmation dialog, which holds no input. This one wraps a part-typed
  form, and a stray click while reaching for a field is the most common way to
  lose that work. Escape still closes, because a focus trap with no obvious
  keyboard exit is just a trap — but Escape is deliberate and a misplaced click
  is not.
- **Initial focus is placed by hand via `[data-autofocus]`, not React's
  `autoFocus`.** Child effects run before the parent's, so `autoFocus` fires
  while the dialog is still `display: none` and the focus is thrown away;
  `showModal()` then runs its own algorithm and lands on the first focusable
  element, which is the close button. The form used to open with the X focused
  and needed a Tab before you could type.
- **The flex column goes on a wrapper inside the dialog, never the dialog.**
  `display` is what the UA toggles to hide a closed `<dialog>`, so setting
  `flex` on the element itself leaves it visible when closed.

**Inside it, the layout follows Asana's task pane rather than a form.** The name
is typed at heading size with no box, the metadata sits in quiet label/value
rows, and the description gets the remaining height. Two earlier attempts were
worse: a flat `lg:grid-cols-7` gave each `<select>` about 100px — narrower than
"In progress" or any real milestone title — and the two-column pairs that
replaced it still drew seven bordered white boxes, so the form read as seven
competing objects with the description the smallest thing on screen.

- **Metadata controls are chrome-less at rest** (`QUIET_CONTROL`), showing their
  border and fill only on hover and focus. That is what drops the apparent item
  count without removing a single field.
- **The controls are capped at `max-w-sm`, not stretched to the panel.** Empty
  space to the right of a short value is what makes the block read as a list of
  facts rather than a wall of inputs — same as the reference.
- **Start and due share one row.** They describe one span, and separate rows
  spent two labels saying so.
- **The timeline hint only renders once a date exists.** Explaining how dates
  draw on the timeline to someone who has entered none is a line earning
  nothing.
- **The row grid is plain `div`s, not the `<dl>` the record lists use.** These
  are form controls with their own labels; a description list makes a screen
  reader announce a six-item list around them for nothing.
- **The title keeps the app's focus ring even though it loses its border.** A
  borderless field with no ring leaves a keyboard user nothing to locate.

**`task-detail.tsx` is where a task is edited, not just read.** It was read-only
apart from the status `<select>`, with an Edit button that closed the panel and
reopened the record in the form — so changing a due date meant leaving the thing
you were looking at. Every field is now editable in place, in the same quiet
rows as the create modal, and the panel therefore owns a `TaskDraft` and does
its own PATCHing instead of reporting changes upward. Its rules:

- **Each edit sends only the field that changed**, via `toPartialPayload`.
  Sending the whole draft would defeat the no-`.default()` design of
  `updateTaskSchema`: two people editing different fields of one task would
  each overwrite the other's with whatever their panel happened to be showing.
- **The draft moves before the request and is restored on failure.** A `<select>`
  bound to the server value visibly snaps back to the old option while the PATCH
  is in flight, which reads as the app rejecting the change.
- **Text commits on blur, selects on change.** Saving a title per keystroke is a
  request per character. An emptied title is treated as a cancelled edit rather
  than a save the server would reject.
- **The panel is keyed on `task.id` by the board**, so opening a different task
  remounts it and the draft starts from that record. This is deliberately not an
  effect copying props into state.
- **The expand control reopens the task in the form modal**, handing over the
  panel's current draft rather than the stored record, so an edit still being
  typed survives the switch. The panel's label column is `4.5rem` rather than the
  modal's `6rem` — at 448px, 6rem left the two date inputs wrapping with the
  arrow orphaned between them.
- **There is no Save button, because there is nothing to submit.** The footer
  reports save state instead.

**`TaskComment` is human discussion, and deliberately outside every other model
here.** It has no `source`/`generationStatus`, so it is not a proposal awaiting
review and never touches `officialRecordWhere()`; the comment routes are the
only task routes that do *not* use that predicate, because a draft task awaiting
review is exactly what reviewers need to discuss. It is also **not grounding
evidence** — project chat answers from documents and official records, and
letting free-text commentary in would put unreviewed opinion behind a citation.

- `authorId` is `SET NULL` and `taskId` is `CASCADE`, following invariant 9's
  reasoning: removing a person must not delete a thread other people replied to,
  but a comment on a deleted task is unreachable in every view.
- The author is always the session user, never a value from the request body,
  and only the author may delete their own comment.
- Comments are **not** in `taskSelect`. `TaskComments` fetches the thread when
  the detail panel opens; every task on the board carrying its whole thread was
  payload read on at most one of them. The panel is keyed on the task, so
  reopening one remounts the thread and shows what is stored.
- Posting is **not** optimistic: a comment is a durable statement attributed to
  you by name, so it appears once the server has stored it rather than being
  drawn immediately and quietly vanishing on failure.

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
- Error boundaries use `retry()`, stable in Next 16.3, rather than `reset()`:
  `retry` re-fetches server data, which is what a failed query needs.
  `app/global-error.tsx` covers a failure in the root layout itself.

## Dark mode

Dark mode is a **palette remap, not `dark:` variants.** Every utility reads a
`--color-*` variable, so the generated block between `/* dark-palette:start */`
and `/* dark-palette:end */` in `src/app/globals.css` inverts each scale
(50↔950, 100↔900, …) and the whole UI follows. Consequences:

- **Do not add `dark:` classes.** Write light-mode classes; they invert.
- **White is a surface, not white.** It maps one step above the page so
  `slate-100` hovers stay visible on a card. For something that must stay dark
  in both themes (a dialog backdrop), use `black`, which is not remapped.
- **Regenerate the block rather than hand-editing it** if Tailwind's palette
  changes or a new colour family comes into use. It is derived from
  `node_modules/tailwindcss/theme.css`.

It follows the OS preference unless the viewer picks Light or Dark in the
sidebar's `ThemeToggle`. The choice is stored in `localStorage` and applied to
`<html data-theme>` by an inline script in the root layout before first paint —
hence `suppressHydrationWarning` on `<html>` — and read back with
`useSyncExternalStore`, so there is no flash and no effect copying the DOM into
state. The script is inline: adding a CSP later needs a nonce for it.

## Chat thread management

`PATCH`/`DELETE /api/chat/conversations/[id]` rename and delete a thread. Both
go through `renameConversation` / `deleteConversation` in
`src/lib/chat/history.ts`, which use `updateMany`/`deleteMany` with the full
`(id, workspaceId, userId)` triple, so another person's thread id matches nothing
and there is no gap between an ownership check and the write. Deleting cascades
to messages and their feedback. With no evidence to ask against, the chat page
keeps the rail and heading so earlier threads stay reachable; only the composer
gives way to the empty state.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
