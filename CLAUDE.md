# CLAUDE.md

Guidance for working in this repository.

## What this project is

**ScopePilot — AI work assistant** for one person or a small team (Hong Kong
first: the UI defaults to Traditional Chinese). It turns the raw material of a
working week — documents, notes, and later emails and voice memos — into cited
tasks, a clear view of what needs you today, and answers grounded in your own
files. **Home is `/today`:** the viewer's open tasks across every project,
bucketed by the viewer's own calendar day. The roadmap (captures, check-ins,
day plans, document labelling, task approaches, email drafts in the user's tone,
read-only Gmail) is in `PLANNING.md`.

**A project holds work and files; two layers are optional per project.** Every
project has Overview, Tasks, and Documents. **Requirements discovery**
(`Project.discoveryEnabled`) — extract cited requirements, review, take
questions to the client, sign off — is for projects that start from a client
brief. **Delivery tools** (`Project.deliveryEnabled`) — timeline, risks, AI
draft plans, weekly reports — are for projects tracked in depth. Both are off for
new projects. Do not grow either into a Jira/Asana competitor: new work should
make the assistant loop (capture → review → act → check in) better.

**Both switches gate navigation, never data or security.** They decide which
tabs show and which widgets render. Hidden routes still resolve (with a notice
and a way to turn the layer on), still enforce workspace scoping, and project
chat still grounds on official records whatever the switches say.

**A RAG workflow with one supervised agent — never an autonomous one.** Every
model call happens inside a request a person started, and the model only ever
proposes — a person's click is what writes. The single exception to "one call
per action" is the Assistant (`/assistant`, invariant 24): inside one request
it may take up to five read-only tool steps before answering, and it is fenced
by a step cap, a time limit, read-only tools, and the same proposal path as
everything else. Do not add multi-agent orchestration, background jobs, loops
that outlive a request, or tools that write. External systems are read-only
and read only when the user asks (Gmail is listed when "Check Gmail" is
pressed, never on a schedule). The app never sends email and never writes to
another system: email drafts leave through copy, `mailto:`, or a compose link
the user opens.

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
   Every prompt follows the same rule with its own label family — capture lines
   are `C`, a capture's candidate tasks `T` and projects `P`.

4. **Refuse before spending a model call.** A chunk must either clear the
   semantic `RAG_MIN_SCORE` or match the PostgreSQL full-text query. If neither
   retrieval path supplies evidence, `answerQuestion` returns the refusal
   without invoking the chat provider. A capture is not a question: its
   evidence is the person's own note, which is always present, so there is no
   retrieval gate — but every proposal must still cite a `C` line or it is
   dropped.

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
   **Progress notes are a third family, labelled `N` and attributed.** A
   task's comments — Today check-ins, capture progress notes, typed comments —
   are where its progress lives, so a progress question in project chat
   reads the newest three on its top tasks, and a task thread always reads
   that task's newest eight. Each says who wrote it and when, and the prompt
   says to cite it as that person's report, never as a document's requirement
   or a field of the record. **Which records are read is decided by the
   question's words** (`readQuestionIntent`, `src/lib/rag/intent.ts`), never
   by the model: "pending"/"未完成" lists only unfinished work (finished work
   stays in the snapshot's counts), and a question about the project's own
   work that does not name its files is answered without document passages.

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

15. **"Today" is the viewer's local day, and it is a date anchor, not an
   instant.** Date-only values stay at UTC midnight and every rule in `rules.ts`
   still compares at UTC-day granularity. What the rules receive is
   `getViewerToday()` (`src/lib/viewer.ts`) — UTC midnight of the viewer's local
   date from `localToday(User.timeZone, now)` in `src/lib/time.ts`. Every page
   that decides overdue / due today / due soon passes it (Today, dashboard,
   Overview, the board's `nowIso`, the timeline), so the pages cannot disagree
   between 00:00 and 08:00 in Hong Kong. Never pass it where an instant belongs —
   `completedAt`, `reviewedAt`, report windows, chat snapshots' `observedAt`.

16. **UI language is a preference; Chinese is Traditional only.** `User.locale`
   (`zh-Hant` default, `en`) is read by `getLocale()` in `src/lib/i18n/server.ts`
   (user row → `locale` cookie → Accept-Language, where every `zh*` maps to
   `zh-Hant`). Copy lives in `src/lib/i18n/dictionaries/`; `en.ts` defines the
   keys and `zh-Hant.ts` must `satisfies Dictionary`, so a missing key fails the
   type-check, and `tests/i18n-dictionaries.test.ts` fails on any Simplified
   character (`containsSimplified` in `src/lib/language.ts`). Model output
   follows the *input's* language by a deterministic `detectReplyLanguage()` —
   Hong Kong code-mixing counts as Chinese — never by asking the model to match.

17. **A personal project is hidden, not private.** `Project.personalOwnerId`
   marks each person's own project (one per person per workspace, by
   `@@unique([workspaceId, personalOwnerId])`). `visibleProjectWhere(workspaceId,
   viewerId)` in `src/lib/pm/visibility.ts` keeps colleagues' personal projects
   out of *navigation and lists* — the sidebar, Projects, the chat and document
   pickers, the dashboard — and nothing else. Their tasks and documents still
   resolve by id for any member and still ground workspace chat, because the
   workspace is the security boundary (invariant 1). Content that must be
   private belongs in a per-user table read with `(id, workspaceId, userId)`.
   The visibility filter carries an `OR`, so it is combined with `AND`, never
   spread (`inVisibleProjects`).

18. **An invite link is a bearer token, stored only as a hash.** Tokens are 32
   random bytes, returned once by `POST /api/workspace/invites`, and kept as
   `sha256` in `WorkspaceInvite.tokenHash`; every lookup is by hash. Accepting
   claims the invite with a conditional `updateMany` in the same transaction as
   the membership insert, so a link admits exactly one person. The page that
   accepts (`/invite/[token]`) lives outside `(app)`, whose layout would
   otherwise provision a workspace for the invitee before they join; accepting
   is a POST, never a side effect of opening the link.

19. **A capture is private, and its proposals are never silent writes.**
   `Capture` and `CaptureProposal` are read and written only with
   `(id, workspaceId, userId)` — a colleague's id matches nothing. The note is
   stored before the model is called and kept if it fails. Applying a proposal
   is an ordinary manual write through `src/lib/pm/task-write.ts` — the same
   functions the task routes call — and the proposal is claimed
   (`pending → applied`, conditional `updateMany`) in the **same transaction**
   as that write, so a double click creates one task. A task applied from a
   capture is a manual record assigned to the person; its provenance is
   `CaptureProposal.appliedTaskId`, not `source = ai_suggested`.

20. **Code resolves dates; the model only quotes them.** The model returns
   `{ phrase, date }`. `validateCaptureProposals` keeps the date only if the
   phrase appears in the cited lines (or their neighbours) and
   `resolveDateExpression(phrase, Capture.localDate)` in
   `src/lib/capture/dates.ts` can read it; the computed date wins, and a
   disagreement with the model's adds a `date_check` flag shown before Apply.
   Vague timing ("下星期", "遲啲", "ASAP") is null, never a guess.

21. **Traditional characters are enforced after validation, on generated prose
   only.** `toTraditional()` (`src/lib/language-convert.ts`, OpenCC `cn → hk`)
   runs on titles, descriptions, and notes the model wrote, after every check
   that compares against the source. Quoted lines and excerpts are never
   converted — they must stay the source's own characters.

22. **General knowledge is labelled, never blended — and only one feature may
   use it.** "How to tackle it" on a task (`src/lib/approach/`) is the single
   place the model is asked even when retrieval finds no evidence, because a
   person stuck on a task wants practical steps their files may not contain.
   `validateApproach()` decides each step's basis from its citations alone: a
   step is `document` only if it cites a passage the model was actually given,
   and everything else is `general` — stored and shown with an explicit "AI
   suggestion (not from your files)" marker and no source chip, and prefixed
   with that marker when copied into a description or a new task. Every other
   answering feature keeps invariant 4.

23. **Outside accounts are read-only, read on request, and their secrets stay
   sealed.** Gmail uses one scope, `gmail.readonly`, through an OAuth code flow
   with state and PKCE in short-lived httpOnly cookies. Only the refresh token
   is kept, AES-256-GCM-encrypted with `INTEGRATION_ENCRYPTION_KEY`
   (`src/lib/crypto/secretbox.ts`); access tokens are fetched per request and
   never stored or sent to the browser. Mail is listed only when the person
   presses "Check Gmail" — no cron, no background sync — and only an email they
   pick is read in full, becoming a private capture (`externalId:
   gmail:{id}`, once per person). Email text is someone else's words: it
   reaches the model only as capture lines marked as data, and nothing it says
   is applied without a click. Applying a new task from it keeps the email as
   a document in the person's personal project, linked to the task — said
   beside Apply before it is pressed — and from then on it is a document like
   any other. The app never sends mail or writes to Gmail.
   **Outlook keeps the same contract** through Microsoft Graph, with
   `offline_access User.Read Mail.Read` and nothing more (`src/lib/outlook/`).
   **WhatsApp connects to nothing:** it has no API for personal chats, so a chat
   is a file the person exports, or text they paste, read in the browser; only
   the part they pick is sent, and it is someone else's words like an email.

24. **The assistant is a fenced loop inside one request.** `runAssistantTurn`
   (`src/lib/assistant/service.ts`) lets the model choose tools step by step,
   and that is all it may do: at most `MAX_TOOL_STEPS` (5) tools, then — or
   once `DEADLINE_MS` (40 s) has passed — it is told to answer and gets no
   more tools. Its tools only read inside the workspace (notes: the caller's
   own) or save a private email draft, except `search_web`: one read-only
   Tavily request, offered only when the person turns on "Search the web" for
   that turn and `TAVILY_API_KEY` is set. Without the key the switch
   stays disabled, and a request that asks for web search runs without the
   tool. The page itself is never fetched — title, an https URL, and a short
   snippet; anything else (`javascript:`, plain http) is dropped. The key
   never reaches the browser. None of the tools writes a task, sends, or
   writes to another system. Every source a tool returns gets an opaque label
   (S, T, N, D, P, W; U1 is the question) through `SourceRegistry`;
   `finalizeAnswer` strips labels the run never issued. A W citation is
   evidence, so a web-only answer is not marked `general`; an answer with no
   W and no workspace source still is, whatever the model claimed. Web
   results are not the person's files and are not general knowledge. Document
   Q&A is unchanged. Changes it suggests go through
   `validateCaptureProposals` (citations, server-resolved dates) and are
   applied only by Apply, through `applyChange` and a claim on
   `AssistantProposal`. History carries wording only, with labels stripped.

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
  models is an env change; swapping vendors is one new file. **Structured
  calls pass `reasoning: false`** (requirements, plans, reports, captures,
  labels, approaches, fills, day plans, email, the assistant's steps, and the
  follow-up rewrite). With a thinking model as `OPENROUTER_CHAT_MODEL`, the
  thinking spent the whole token budget before any JSON was written and
  pushed calls past Vercel's 60-second limit: extraction took 85 s and failed,
  and is 5 s without it. Chat answers pass it too — a follow-up's rewrite plus
  a thinking answer was killed at 60 s with nothing saved. Models disagree on
  the switch: OpenRouter refuses `reasoning: { enabled: false }` for GLM 5.3
  Flash ("Reasoning is mandatory"), so the provider retries such a model with
  `effort: "minimal"` (zero thinking tokens there) and remembers it; DeepSeek
  V4 Flash still thinks at minimal, which is why the off switch goes first.
  OpenRouter spreads GLM over ~34 hosts and some refuse `minimal` as well, so
  the last resort sends no setting at all — the model's default, slower but
  never refused, and still inside the call's time limit.
  **Every provider call has a time limit** (`timeoutMs`, default 45 s), and a
  timed-out call is a `ProviderError` that `isProviderTimeout()` recognises, so
  a route can name it instead of being killed silently. Calls that share one
  request split its budget: `answerQuestion` gives the rewrite 12 s and the
  answer what is left of 50 s, skipping the repair when it cannot finish; the
  assistant skips any call that would not fit in 52 s and answers with what its
  tools found.
  **A run killed mid-call stays `processing` forever**, and both the
  active-run check and the one-active-run index count it, so it would block
  every later extraction or plan. `failStaleRuns()`
  (`src/lib/generation/stale-runs.ts`) fails runs older than `STALE_RUN_MS`
  before each generation and each run-list read; `listCaptures` does the same
  for captures by `updatedAt`, which brings back their Retry button.
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

Signed-in `/` redirects to `/today` (see "Personal work notes" below). The
workspace-wide summary lives at `/dashboard`, titled **Workspace overview** and
reached from the Projects page rather than the sidebar. It opens on the **discovery inbox** —
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

**Status labels are written for the job, not the model.** They live in the
dictionaries under `requirementStatus` (read through `requirementStatusLabel()`
in `src/lib/pm/labels.ts`): `draft` → *To review* / 待審閱, `needs_clarification`
→ *Ask client* / 要問客戶, `validated` → *Validated* / 已核對, `approved` →
*Agreed* / 已議定, `rejected` → *Rejected* / 已否決. Change copy there; never
rename an enum value for wording. The
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

## Personal work notes

`/today` (`src/app/(app)/today/page.tsx`) answers one question — what needs me
now — across every project. `getMyOpenTasks()` in `src/lib/pm/my-work.ts` reads
the viewer's open official tasks through `assignedTo()` from `rules.ts`, and the
pure `bucketMyTasks()` in `src/lib/pm/today.ts` puts each in exactly one bucket,
earliest rule first: overdue, due today, blocked, due in 7 days, later. A
blocked task due today is "due today" — the deadline is the fact that needs
attention — and the row still says it is blocked. Empty buckets are not drawn.

**Undated work is listed, not guessed.** A task with no due date never reaches
a dated bucket, so it used to be only the "N more" count at the foot of the
page. `undatedToShow()` lists the five most important (then most recently
touched) under "No due date", each with an inline date that saves through the
ordinary task PATCH on submit — not on change, because a date field reports a
value as each part is filled and typing a year would save 0002 first. The AI is
never asked to fill a date in; this is where the person does.

**Work that has gone quiet asks for a check-in.** `isStale()` in `rules.ts`
is the only definition: open, and no task write or comment by anyone for
`STALE_DAYS` (5) days, unless the viewer snoozed it through today.
`getMyOpenTasks` carries the newest comment and the viewer's own snooze so the
rule runs on loaded rows. A quiet task is badged where it already appears and
listed under "Needs an update" only if no other bucket shows it. Each Today
row's Update strip posts to `POST /api/tasks/[id]/check-in`
(`src/lib/today/check-in.ts`): done and blocked move the task by category
through `task-write`; "still working" moves a blocked task back to an open
column, or on an open task only sets `Task.checkedInAt` — which moves
`updatedAt` and so clears the reminder; a note becomes the person's comment in
the same transaction. **Snooze is a separate `TaskSnooze` row, never a task
write**, because writing to the task would make it look worked on.

**The day plan is a suggestion that changes nothing.** `POST /api/today/plan`
ranks the viewer's open tasks with the pure `rankTasks()` (deadlines first,
priority within, blocked sinks, quiet rises a little), sends the top 40 as `T`
labels with relative due facts, and `validateDayPlan()` keeps known labels
once each, uses the person's own estimate over the model's, clamps blocks, and
cuts from the end at the first block that would overrun the hours given. It is
stored per person per local day (`DailyPlan`, re-planning replaces it) and read
back joined with each task's live status, so a finished task is ticked without
the plan remembering anything.

**A planned item is checked in where it is listed.** Each item has the same
Update strip as a Today row (`CheckInStrip`, shared, snooze left out), and its
mark comes from `planItemState()`: done, or *updated* once the task was written
to or noted on after the item's `plannedAt`, else pending. Items carry
`batch` and `plannedAt` inside the plan's JSON, so no column was added. When
nothing is pending, the card offers **the next batch**: `append: true` leaves
out every task already in today's plan, adds the new items after the old with
the next batch number, and adds the hours — so a task is never planned twice in
a day and the earlier batch stays visible as what was done. Re-planning still
replaces the whole day. The Today page keys the card on its items' marks, so a
check-in made on a Today row below also brings the plan's marks up to date.

**"Mine" depends on the workspace.** In a workspace of one, every task is that
person's, set assignee or not (`isSoloWorkspace`), so unassigned tasks are
included. With colleagues, only tasks assigned to the viewer count.
`assignedTo(userId, where, { includeUnassigned })` widens with an `AND` of the
whole filter, never a spread, because the official-record `OR` and the
"me-or-nobody" `OR` would otherwise overwrite each other.

`/settings` holds per-person preferences (language, time zone) and saves each
control as it changes through `PATCH /api/me/preferences`, which writes only the
session user's row and mirrors the language into a cookie for signed-out pages.
`getUserPreferences()` rides on the same cached user lookup `getSessionUser()`
already makes, so pages pay no extra query for it.

**Every page reads `t()`; new UI must too.** The dictionaries are split by
area — `src/lib/i18n/dictionaries/areas/<area>.en.ts` and its `.zh-Hant.ts`
twin, spread into the root `en.ts` / `zh-Hant.ts` — so one `Dictionary` type
still checks every key. Labels for stored values (statuses, levels, MoSCoW,
categories, delivery and run states, report health) are shared keys, never
English maps in `lib/`; pure modules that render text (`requirements-export`,
`next-actions`, `relative-time`, the report Markdown) take a `Translate`.
`labelOr(t, key, fallback)` reads a stored value a dictionary may not know (a
frozen snapshot's status) and falls back to the value rather than printing the
dotted key. Seeded task-column labels are data and are translated only when
untouched (`displayStatusLabel`); a renamed column is shown as typed. Text from
the person's documents and records is never translated.

**Dates and lists always get an explicit locale — and instants a time zone.**
A date-only value (due, target, a capture's `localDate`) uses `formatDay(value,
intlLocale(locale))`, pinned to UTC. An instant (`createdAt`, `reviewedAt`,
`observedAt`) uses `formatDate(value, locale, timeZone)` or
`formatInstantDay(…)` with the viewer's zone — `getViewerTimeZone()` on the
server, `useTimeZone()` from the `I18nProvider` on the client. Formatting an
instant with `formatDay` dated a 01:00 Hong Kong upload the day before, and
leaving the zone to the runtime printed different text on Vercel's UTC server
than in the browser. The Gantt axis and calendar labels take a locale too
(`buildGantt(…, locale)`, `buildCalendarMonth(…, locale)`). Lists of words use
`Intl.ListFormat`, which knows 「、」 from ", and".

**Files that leave the app choose their own language.** Requirement exports and
client packs follow the viewer's language unless `?lang=en|zh-Hant` asks for the
other (`getFileLocale()`); the print page links to the other language, because
a pack is written for the client. The global error page is bilingual, since the
root layout that resolves the language is what failed. API error messages are
still English.

## Capture notes

`/capture` and the box at the top of `/today` are where a person tells the
assistant something — typed, pasted, dictated, or from a file. One model call
(plus the usual single repair) turns it into proposals of three kinds:
`create_task`, `update_task` (status by category, due date, priority), and
`add_note` (a progress note written as a `TaskComment` by the person).

- **The pipeline is `src/lib/capture/`:** `lines.ts` splits the note into `C`
  lines (per newline and sentence, hard-splitting long unpunctuated dictation);
  `context.ts` loads the person's open tasks as `T` candidates
  (`rankTaskCandidates` — shared words first, Chinese by character pairs) and
  visible projects as `P`; `prompt.ts` (`capture-v3`); `schemas.ts` parses each
  proposal separately so one bad item costs only itself; `validate.ts` is the
  deterministic gate; `service.ts` stores, calls, validates, and applies.
- **When unsure, create — don't update.** Rule 2 once said "prefer changing an
  existing task", and the model read new work as an update to whatever task
  shared a word with it. A wrong update silently changes real work, while a
  new task that repeats one is flagged and dismissed in one click, so
  `capture-v3` changes a task only when the line is clearly about it.
- **Titles are tidied, not transcribed** (`capture-v4`, `TASK_TITLE_STYLE`,
  shared with the assistant). Dictated Cantonese came back as task names like
  「將月報交俾老闆睇」. Chinese titles and descriptions are written Chinese
  (書面語), English ones plain English; fillers go; names, numbers, amounts,
  codes, and technical terms stay exactly as written. Nothing of the person's
  is lost — their words stay in the cited lines.
- **Updates must change something.** A status the task already has, or its
  current due date, is dropped as a no-op rather than offered as an Apply that
  does nothing. A new task matching an open title is *flagged*
  `possible_duplicate`, never dropped.
- **A wrong suggestion can be redone, not just dismissed.** Each pending row
  takes a correction ("this is a new task, not the monthly report"), sent to
  `POST /api/capture-proposals/[id]/revise` (`reviseProposal`). The correction
  is the person's own words, so it is appended to the note in SQL (`body ||`,
  so two corrections at once both survive) as a `補充：` / `Clarification:`
  line *before* the model is called, and kept whatever happens. Appending
  leaves every earlier `C` label where it was. Rule 12 makes a correction win
  over the lines it corrects; `buildReviseBlock()` names the suggestion by its
  `T`/`C` labels, never an id, and lists the other pending suggestions so the
  replacement does not repeat one — `pendingTitles` flags it
  `possible_duplicate` if it does anyway. Replacements (≤3) pass the same validator, and
  the old row is claimed (`pending` → deleted) in the transaction that writes
  them, so a row applied meanwhile is never replaced. A note at the
  150-line limit refuses, rather than have the correction cut off its end.
- **A new task always has a description.** The model writes one or two
  sentences from the cited lines; with none, `validate.ts` uses the cited lines
  themselves — the person's own words, unconverted, marker stripped.
- **Priority is read, never guessed:** only explicit words (急, 重要, 唔急…).
  Without them a new task is saved at medium, and the row says so ("default:
  not mentioned") rather than showing a blank that reads as a judgement.
- **Status goes by category, never by label.** `pickStatusForCategory()` picks
  the first column of that category in board order, preferring the seeded
  `in_progress` for "still going". A project with no blocked column refuses
  the update with a message instead of inventing one.
- **New tasks land in the personal project** unless the person (or a
  confident `P` label) names another, and are assigned to the person applying
  unless they pick a colleague in the row (`assigneeId` override; the picker
  shows only with colleagues, and `prepareTaskCreate` refuses a non-member).
  The assignee is code and the person's choice, never the model's.
  "Apply all" skips flagged proposals; each item applies in its own
  transaction so one refusal does not undo the rest.
- **Files:** `.txt`/`.md` are read in the browser into the box. PDF and Word go
  through the ordinary upload route into the personal project, are indexed,
  and are captured from `Document.extractedText` (first 12,000 characters); a
  task applied from it links the document wherever the task is filed — the
  file waits in the personal project, and its work usually belongs elsewhere.
- **Dictation is the browser's Web Speech API** — no server of ours, but the
  browser sends audio to its vendor, and the button says so. Language tags
  differ by browser (`yue-Hant-HK` in Chrome, `zh-HK` in Safari), so each
  language lists fallbacks tried on `language-not-supported`.
- **The capture is never evidence** unless the person chooses to keep it.
  There are two deliberate paths from private to workspace-visible, and each
  says so before the click. "Save as document" (`saveCaptureAsDocument`)
  writes the note as a Markdown document into their personal project through
  `storeDocument` and indexes it, after a confirmation. **Applying a new task
  from an email** (a dropped `.eml`/`.msg`, Gmail, or Outlook) does the same
  for the email first, because the task should carry the message it came from;
  the list says so beside Apply (`capture.emailAttachNotice`). Both go
  through `keepCaptureAsDocument`, and `captureDocument()`
  (`src/lib/capture/document.ts`, pure) names an email by its subject and keeps
  its sender and date. The capture records the document, so it is saved once
  and every later task from it links the same one; two Applies racing keep the
  first and remove the second's file. The apply route indexes it in the same
  request. Saving the email never blocks the task: if it fails, the task is
  still created, without the link. Notes on existing tasks save nothing.

## Document filing notes

**Every file becomes a Document through `storeDocument()`**
(`src/lib/documents/store.ts`): three-way validation, the row first, then the
bytes under `{workspaceId}/{documentId}.{ext}`, and the row removed if storage
fails. The upload route and "save a capture as a document" both call it.

**Labels are written after indexing, in their own request.** The panel
uploads up to two files at a time, then calls `/process`, then
`POST /api/documents/[id]/label` (`label-service.ts`), so indexing keeps its
60-second budget. Labelling reads up to 12 passages as `S` labels and the
viewer's visible projects as `P` labels. `validateDocumentLabel()` keeps a
summary only if it cites a real passage, files an unknown type as `other`,
cleans and caps tags at six, and suggests a project only when it differs from
where the document is. **A person's edit wins:** `PATCH /api/documents/[id]`
with a title, type, or tags sets `labelSource = "manual"`, after which an AI
pass refreshes only the summary and suggestion. Moving a document anywhere
clears its suggestion.

**Search is not grounding.** `searchDocuments()` combines `ILIKE` over every
indexed passage and the labels — which works for Chinese, because a phrase
either appears or it does not — with the chat's hybrid retrieval held to the
same `hasGroundingEvidence` bar, and quietly drops the meaning half if
embeddings are unavailable. Results are links to read, never model input, so
the lexical grounding path (and its `english` configuration) is unchanged.
`/documents?q=` is a GET form, so a search is a link.

**Citations open the passage.** Passages carry `id="chunk-{id}"`, and
`/documents/[id]/chunks?chunk={id}` opens the page holding that passage and
outlines it. Chat source cards and search results link there. A ready
document's page offers "Ask about this document" (`/chat?docs={id}`).

## Assistant notes

`/assistant` is the agent; `/chat` ("Ask documents") stays the strictly
grounded, scope-pinned Q&A. Both are in the sidebar under those names.

- **The protocol is JSON steps, not native tool calling.** Each model reply is
  one object — `{"action":"<tool>","input":{…}}` or `{"action":"answer",…}` —
  parsed by `parseStep`. Any model with a JSON mode can run it, and tests
  drive the loop with a scripted fake. An unknown tool is reported back, not
  run; two malformed replies end the turn with an honest fallback answer.
- **Tools** (`tools.ts`): `search_documents` (the chat's hybrid retrieval at
  the same evidence bar, falling back to a literal match without
  embeddings), `list_my_tasks` (Today's buckets, staleness, and ranking),
  `get_task` (description, recent notes, linked documents — by label only),
  `search_notes` (the caller's own captures), `draft_email` (saves a
  private draft through the email service; never sends), and `search_web`
  (one Tavily search, snippets only). `search_web` is listed in the system
  prompt only when the composer switch is on and `TAVILY_API_KEY` is
  set; otherwise `parseStep` reports it as an unknown tool and it is not
  run. Bad input returns text the model can correct.
- **Web search is a composer switch, off by default.** The chip lives on the
  assistant page (`aria-pressed`, 「搜尋網頁」 / "Search the web") and stays
  as set while the page is open. The page reads whether the key is set and
  passes only that boolean; the key stays server-side. Each hit is a W
  source (title, https URL, excerpt) stored in the message's existing
  `sources` JSON. A W chip is an external link (`target="_blank"`,
  `rel="noopener noreferrer"`). Document chips stay inside the app.
- **What a turn stores:** the answer, the public form of each cited source
  (enough to link — passage, task, note, draft, project, web page), the tool
  trace shown as "What it looked up", the general flag, draft ids, and
  proposals.
- **Proposals render through `ProposalList`** (`components/capture/
  proposal-list.tsx`), shared with captures; only the apply and decide
  endpoints differ. Applying both kinds goes through
  `src/lib/capture/apply-change.ts`, which takes the claim as a hook.
- A turn is one request (`maxDuration` 60), so the page waits for the answer
  rather than streaming steps. Threads are private, like chat threads.
- **When the model will not answer**, the loop makes one last call that may
  only answer; if that fails too, `foundSoFar()` lists what the lookups found
  (with their labels, so they render as sources) instead of discarding them.

## Email, WhatsApp, and voice notes

**Outlook** (`src/lib/outlook/`) is Gmail's twin for a company Microsoft 365
account or a personal one, offered only when `MICROSOFT_CLIENT_ID`,
`MICROSOFT_CLIENT_SECRET`, and `INTEGRATION_ENCRYPTION_KEY` are set. Three
differences matter:
- **One registration, both kinds of account:** sign-in goes through the
  `common` endpoint (redirect URI `/api/integrations/microsoft/callback`).
- **Refresh tokens rotate:** every refresh may return a new one, which is
  sealed and stored in place of the old. Keeping the first one would stop
  working within days.
- **A company may need IT to approve the app first.** The callback recognises
  that refusal (`needsAdminConsent`: AADSTS65001/90094/90008) and the Capture
  page shows an administrator approval link (`adminConsentUrl`) to send IT,
  rather than a generic failure. `invalid_grant` and `interaction_required`
  (MFA, conditional access) mark the account `needsReconnect`.

"Check Outlook" lists the last three days of the Focused inbox, headers only.
Focused is filtered in code because Graph refuses most filter-and-sort
combinations. A picked message is read as text through `uniqueBody` (the part
not quoted from the thread) and captured once per person (`outlook:{id}`).
Disconnecting deletes the token; Microsoft has no per-app revoke short of
signing the person out everywhere. Both mailboxes render through one
`MailboxPanel` and one Settings row (`MAILBOX_ROUTES`, `src/lib/mail/mailboxes.ts`),
and share the mail-text helpers in `src/lib/mail/text.ts`.

**Mail files are the way round a blocked company.** An `.eml` (Outlook on the
web) or `.msg` (dragged out of Outlook for Windows) dropped on the capture box
is read in the browser (`src/lib/mail/file.ts`: `postal-mime`, which honours
Big5; `@kenjiuno/msgreader`) and captured as `source: email`. The file itself
is never uploaded; the email's text becomes a document only when a task is
applied from it (see Capture notes). The capture box accepts a drop of any file
it can read.

**Every uploader takes email too** — the task panel and form, the Documents
pages, and the requirements source upload — and the server still never sees
an email file. `asUploadable()` (`src/lib/mail/document.ts`) reads a chosen
`.eml`/`.msg` in the browser and uploads it as the Markdown document
`mailDocument()` writes: named by the subject, sender and date above the
message, quoted thread kept (a capture cuts it; a kept email is read later for
its context). So the upload route's three-way check (invariant 6) and
indexing are unchanged, and the parsers load only when an email is chosen.
Attachments inside the email are not kept. A capture's email is saved through
the same `mailDocument()`, so the two cannot name an email differently.

**WhatsApp** (`src/lib/whatsapp/parse.ts`, pure) reads an exported chat — an
iPhone's `.zip` holding `_chat.txt`, opened in the browser with `fflate` and
never uploaded, or an Android `.txt` — or messages pasted into the capture box.
WhatsApp writes a different shape per phone and region (iPhone `[d/m/y, time]`,
Android `d/m/y, time - `, Desktop copy `[time, d/m/y]`, Chinese-region
`y/m/d 上午…`); day comes before month as Hong Kong writes it, unless a value
over 12 proves otherwise. System lines and media placeholders are dropped, and
unstamped lines continue the message above. The box shows a chat card instead
of the raw text: the person says which name is theirs (remembered in
`localStorage`, since it is the same in every chat) and how far back to read,
and only that part is sent, newest kept if it is too long, as a `whatsapp`
capture. **Each line carries its own day** (`[2026-10-18 09:15] Peter：…`) and
the validator counts a relative date from the day of the line that says it,
the nearest stamped line above for a message split into sentences, because a
"聽日" written three days ago meant two days ago. The capture prompt is told
whose words the lines are (`CaptureLinesSource`): 我 is the person, everyone
else is data.

**Gmail** (`src/lib/gmail/`) is offered only when `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and a 32-byte `INTEGRATION_ENCRYPTION_KEY` are all set;
otherwise the panel simply does not render. `APP_URL` fixes the redirect URI
(`/api/integrations/google/callback`), which must match the one registered
with Google. When Google answers a refresh with `invalid_grant` — a revoked
grant, or the seven-day expiry of an app still in Testing — the account is
marked `needsReconnect` and the page asks for a reconnect instead of failing
on every press. `listRecentMail` reads headers only (`format=metadata`) for
the last three days of inbox mail outside Promotions and Social; `captureEmail`
reads one message (`format=full`), keeps plain text over HTML, cuts the quoted
history (`stripQuotedReply`), and hands it to `createCapture` with a `SOURCE`
line telling the model these are a received email's words. An email capture
links to `/email?capture={id}`, which opens a reply with that email as the
incoming text.

**Voice memos** are recorded in the browser, decoded and resampled to 16 kHz
mono, and encoded as WAV (`src/lib/audio/wav.ts`) because OpenRouter's
`input_audio` does not accept the browser's webm. Each ≤55-second segment is
its own `POST /api/transcribe` (WAV bytes checked, ≤3 MB), well under Vercel's
body and time limits. `TranscriptionProvider` is a separate interface so the
text `ChatProvider` contract stays a plain string; it uses
`OPENROUTER_TRANSCRIBE_MODEL` (default `google/gemini-2.5-flash`, the model
OpenRouter's audio docs use). Audio is never stored; Chinese transcripts pass
through `toTraditional`, and the text lands in the capture box for the person
to read before anything is proposed from it. Live dictation (Web Speech) and
recorded memos share one language picker.

## Email draft notes

`/email` drafts emails in the person's own voice; **nothing is ever sent.** A
draft leaves only by Copy, Gmail's compose window (`gmailComposeUrl`, which
fills `view=cm` and waits for the person), or `mailto:` — all in
`src/lib/email/links.ts`, and a name is never put in "to" unless it is an
address.

- **Tone is per person, across workspaces.** `WritingStyle` (unique on
  `userId`) holds up to ten of their own emails, a signature, and a tone
  description derived from the samples by one call (`deriveStyleProfile`, at
  least two samples) and editable by them. Drafts use up to three samples *in
  the target language* as examples.
- **Facts come only from what the person gave.** The prompt says so, and
  `findUnsupportedFacts()` (`src/lib/email/facts.ts`, pure) checks: every
  date, time, weekday, amount, percentage, two-digit-plus number, address,
  and link in the draft must appear in the key points, the email being
  answered, the recipient, the task's own facts, or the signature — otherwise
  it is flagged above the draft. The example emails are deliberately *not*
  in that list: they shape tone, never facts. Bracketed placeholders are
  flagged as "fill in". The draft text is never altered by the check.
- **Task facts** come from the official task (workspace-scoped) and its three
  newest comments — this is the person's own outgoing message, not a cited
  answer, so comments are fair context here.
- **Model:** `getWritingProvider()` uses `OPENROUTER_WRITING_MODEL` when set,
  otherwise the chat model, so tone can get a stronger model without moving
  every feature. Chinese drafts pass through `toTraditional`.
- `EmailDraft` keeps the last drafts per person (private, triple-scoped), so a
  reload does not lose one. The task panel's approach tab links to
  `/email?task={id}`.

## Team workspace notes

A person may belong to several workspaces. `getOrCreateDefaultWorkspace()`
resolves which one a request acts in: `User.activeWorkspaceId` while they are
still a member of it, else their earliest membership, else a new workspace.
The column is a preference, membership is the permission — a stale choice is
ignored, never trusted. `PUT /api/me/workspace` checks membership before saving
a choice, and accepting an invite sets it, so an existing user who joins a team
lands in the team's workspace. The sidebar shows a switcher only with two or
more memberships; switching lands on `/today`, because the open project belongs
to the old workspace.

Member rules live in the pure `canChangeMember()` (`src/lib/workspace/invites.ts`):
only admins change other people, anyone may leave, the owner is never removed
or demoted (deleting the owner's user row is what deletes the workspace), and
the last admin is never removed or demoted. Removing someone clears
`personalOwnerId` on their personal project in that workspace, so their work
becomes an ordinary project the team can see instead of one hidden from
everyone. The service is `src/lib/workspace/service.ts`; Settings renders it
through `members-panel.tsx`.

The sign-in page takes `?callbackUrl=`, validated once on the server by
`safeCallbackUrl()` (`src/lib/auth/callback-url.ts`) — `//host` and `/\host`
are protocol-relative to a browser, so "starts with /" is not enough. That is
how an invite link survives sign-in or sign-up.

Every person gets a personal project in each workspace, created by the `(app)`
layout on first visit (`getOrCreatePersonalProject`, which re-reads on a
concurrent create and adds the email on a name clash) and pinned first in the
sidebar with a person mark. New tasks default their assignee to the creator
(`emptyDraft(statusId, currentUserId)`), so a task you write down appears on
your own Today in a team workspace.

## Project management notes

`/projects/[id]` has three core sections — **Overview, Tasks, Documents** — then
**Requirements** when `discoveryEnabled`, then four delivery sections when
`deliveryEnabled`: **Timeline, Risks, Plan** (route `/review`; renamed because
the tab is where a plan is generated, not merely reviewed) **and Reports**. The
Overview follows the same layers: the discovery strip only with discovery on,
task stats always, milestones/risks/reports only with delivery on, and one card
offering whichever layers are off. They are nested
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

**Routes:** `/today` is home — the viewer's own work. `/dashboard` is the
workspace overview (every project and member) and `/documents` is cross-project
document administration. The sidebar's global links are Today, Projects,
Documents, Capture, Assistant, Ask documents, and Email, with Settings in the
footer; the workspace overview is reached from Projects, so each question has
one entry.
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
the server for the same hydration reason `ProjectTimeline` does — and it is the
viewer's day anchor (invariant 15), threaded down to `isTaskOverdue(task,
todayIso)` on cards, list rows, and the detail panel rather than read from the
browser clock. Risks default
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
- **Start and due are separate rows.** Each carries its own label. One
  "Dates" row left two identical boxes, and the names existed only as
  accessible labels.
- **The start date shows only where it means something.** It draws a bar on
  the timeline, which only delivery projects have, so elsewhere the row is the
  due date alone. A task that already has a start date keeps the field, so it
  can still be seen and cleared, and the timeline hint shows only with a
  timeline.
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
  modal's `6rem`, because the panel is 448px wide. Each date is its own row, so
  the column only has to fit the label.
- **There is no Save button, because there is nothing to submit.** The footer
  reports save state instead.

**"How to tackle it" is the task panel's third tab** (`task-approach.tsx`).
Evidence is the task's linked documents (`selectDocumentContext`, 12
passages), else the project's documents held to the chat's evidence bar, else
none — and then every step is general (invariant 22). A suggestion is a
private `TaskSuggestion` per person and is never applied by itself: "Add steps
to the description" goes through the panel's own `save()`, and "Create tasks"
(`POST /api/task-suggestions/[id]/create-tasks`) goes through `task-write`,
claiming each step index on `createdSteps` in the same transaction as its
task so a second click creates nothing. **A step's task is linked, not
annotated:** the same transaction adds a dependency from the original task
to it, so the original's panel lists its steps and "waits on" them, and the
step's panel shows the original under "Needed for" (reverse edges are found
in the board's own rows, not a second query). It also joins the original's
milestone and carries the passages its step cited as Sources, with their
documents linked; a milestone or document that has since left the project is
left off rather than failing the request. The step formatter lives in
`approach/format.ts`, apart from the validator, so the browser bundle never
pulls in OpenCC.

**`TaskComment` is human discussion, and deliberately outside every other model
here.** It has no `source`/`generationStatus`, so it is not a proposal awaiting
review and never touches `officialRecordWhere()`; the comment routes are the
only task routes that do *not* use that predicate, because a draft task awaiting
review is exactly what reviewers need to discuss. It is grounding evidence
**only as a progress note** (`N`, invariant 13): attributed to its author and
time, read for progress questions and task threads, and never passed off as a
document or a record field — because put behind an ordinary citation it would
dress up one person's opinion as fact, while leaving it out entirely meant
"how is it going?" ignored the very place progress is written down.

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

**A task's documents are links, not attachments.** `TaskDocument` joins a task
to an ordinary project document, so uploading from the task form goes through
the same `/api/documents` route, three-way validation, and indexing as the
Documents tab — the file is searchable by chat and readable by the AI fill, and
there is one copy of it. Both foreign keys cascade. Every id is resolved inside
the task's own project by `resolveTaskRelations()` in
`src/lib/pm/task-relations.ts` before any write. On `PATCH /api/tasks/[id]`,
`documentIds` *replaces* the linked set, while `citations` and
`requirementIds` only add; the detail panel links and unlinks one at a time
through `/api/tasks/[id]/documents`, and keeps its draft's `documentIds` in
step so "expand to form" cannot save a stale set back.

**A link can outlive its project; a new link cannot.** `resolveTaskRelations`
takes `carriedDocumentIds` — documents the server vouches for although they
may be filed in another project of the workspace: the links a task already
has (`prepareTaskUpdate` reads them), and the file a capture was made from
(`applyChange`). They never come from the request. So the picker still offers
only the project's own documents, while a task moved between projects, or
applied from a captured file into a client project, keeps its document — and
the task chat (`answerFocusFor`, retrieval without the project filter for a
task's links only), the AI fill, and "How to tackle it" read it there. A plan
run's drafted tasks link the documents they cite, which are always the run's
own project's.

**Moving tasks between projects** is `POST /api/tasks/move`
(`moveTasks()` in `src/lib/pm/task-move.ts`): official tasks only, into a
project the viewer can see (`visibleProjectWhere`), all in one transaction.
The column follows the task by key, then category, never preferring In
progress (`pickStatusForMove`; blocked work falls to the default column where
there is no blocked one, and the toast says so). What belongs to the old
project is cleared — the milestone, requirement links, and dependencies on
tasks that stay behind — while dependencies *between* tasks moved together
survive, which is why it is one request rather than one per task. Fields,
notes, sources, and document links come along; **the documents stay filed
where they are**, because moving a file would take it from every other task
and from the project chat it serves. The board's confirmation counts what
will be cleared from its own rows. A task thread is held to the project it
began in, so after a move the panel opens a fresh thread and the old one
refuses to continue with a 409, as for a deleted task. Each update writes
`updateMany` conditional on the old `projectId`, so two concurrent moves
cannot both clear links.

**"Fill blanks with AI" proposes; the user saves.** `POST
/api/projects/[id]/task-fill` (`src/lib/generation/task-fill-*.ts`) is one
user-initiated request and one model call (plus the usual single repair). It
persists nothing, which is why there is no generation run to audit: the result
goes back into the task form, `applyTaskFill()` in `src/lib/pm/task-fill-apply.ts`
writes it into **blank fields only**, and nothing is stored until Save. Rules:

- **Evidence follows the grounding invariants.** With linked documents, those
  are read (`selectDocumentContext(…, [title], MAX_FILL_CHUNKS)`); without, the
  project is searched like chat and must clear `RAG_MIN_SCORE` or match
  lexically, or the request is refused **before** the model is called.
  Sources are `S` labels and requirement candidates `Q` labels, never ids.
- **Every field needs its own citation**, and each fails alone —
  `modelTaskFillSchema` uses `.catch(null)` per field so one bad date does not
  discard a good description.
- **Dates and effort are checked against the cited text, not trusted.**
  `sourceStatesDate` requires the year and day to appear in a cited passage, and
  `sourceStatesEffort` the hours (or days × 8). This is the deterministic
  backstop for the prompt's "stated values only" rule: "two weeks after
  kickoff" must never become a calendar date.
- **Priority is blank only while it is the untouched default.** It always holds
  a value, so the form tracks whether a person chose it.
- **The detail panel does not apply a fill in place.** Every other field there
  saves as it changes; a fill would write model output straight to the task, so
  it opens the form with the report instead.
- **A saved fill keeps its sources.** The passages behind the filled fields are
  sent as `citations`, which the server re-reads and re-excerpts
  (`buildVerifiedExcerpt`) so a client cannot put words in a document's mouth,
  and are stored as `TaskCitation` with purpose `proposal` — the task detail's
  existing Sources list shows them. Cited documents join the task's links.

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

## Focused chat: one task, or chosen documents

A thread can be narrowed inside its scope. `ChatConversation.focus` is `none`,
`task`, or `documents`; changing it starts a new thread exactly as changing
project does, so evidence sets never mix. The route resolves a new thread's
focus with `resolveNewThreadScope()` in `src/lib/chat/focus.ts`, and an
existing thread is **held to what it was started with** — a request may name
its project or task, never re-point it.

- **Task focus** (the task panel's *Ask AI* tab, or the Ask page's focus
  picker) replaces the project-wide record selection with
  `getTaskGroundingContext()`: the task itself, always `[T1]`, then its
  dependencies, milestone, and *approved* requirements — the same source
  builders as project chat, so a citation's snapshot has one shape. Retrieval
  reads the task's linked documents, fetched fresh each turn so linking one
  takes effect on the next question and read wherever they are filed, or the
  whole project when it has none.
  Official tasks only; the task's newest notes come along as `N` sources,
  because a question in a task thread is usually about its progress. `taskId` is `SET NULL`: a
  deleted task's thread stays readable, `focus` stays `task`, and the route
  refuses to continue it with a 409.
- **Document focus** is document-only, like global chat. `focusDocumentIds`
  is a filter, not a relation, and lives **inside** both retrieval SQL paths
  (`retrieveChunks(…, documentIds)`) — filtered afterwards, the rest of the
  project would fill the LIMIT and the focus would return nothing.

**Task threads may propose edits; they never make them.** `TASK_SYSTEM_PROMPT`
lets the model return `proposals` (description, priority, estimate, dates),
and `validateProposals()` in `src/lib/rag/proposals.ts` runs them through the
task fill's validator — a citation per field, dates and effort checked against
the cited text — so chat and "Fill blanks with AI" clear one bar. A refused
answer offers nothing. Proposals are stored on `ChatMessage.proposals` so a
replayed thread still shows them, and **Apply is the ordinary task PATCH**
(`proposalPatch()`), carrying only document citations since a live record has
no chunk to store. "Applied" is derived from the task's current value, not
remembered. Task threads skip project chat's intent gate and mixed-heading
rule: nearly every question in one says "task" and `[T1]` is always supplied,
so those rules would refuse ordinary answers that cite a document.

Both surfaces read the stream through `streamAnswer()` in
`src/components/chat/ask-stream.ts`, so a guard error, a dropped stream, and a
superseded question are handled once.
