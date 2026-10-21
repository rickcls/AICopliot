# PLANNING.md

Living plan and decision log for ScopePilot — AI work assistant.

---

## Goal

An AI work assistant for one person or a small team, Hong Kong first. It
removes the bookkeeping from a working week: turn notes, documents, and (later)
emails and voice memos into cited tasks and progress updates the user approves
with a click; show what needs the user today across every project; find files
and answers grounded in the user's own documents; suggest how to tackle a task;
and draft emails in the user's own tone. Requirements discovery and delivery
tracking remain, as optional layers per project.

**Explicitly out of scope**, now and later unless deliberately revisited:
multi-agent orchestration, loops that outlive a request, background jobs or
schedules, tools that write, and any action that writes to an external system.
The model proposes; a click writes. The one agent (P7) is fenced inside a
single request with read-only tools. External systems are read-only and read
only inside a user-initiated action (Gmail, P6). The app never sends email.

### Assistant roadmap (pivot approved 2026-10-16)

Each phase is one branch and PR, usable on its own.

| Phase | Pain point | Scope | Status |
|---|---|---|---|
| P0a | Foundation | Product docs, i18n (zh-Hant default + en), `User.locale`/`timeZone`, viewer-local "today", Today page, Settings, Tasks as a core tab, `discoveryEnabled` | **Built on `feat/assistant-foundation`** |
| P0b | Team | Invite links, member roles, workspace switcher, personal project hidden from colleagues' navigation, new tasks assigned to their creator | **Built on `feat/assistant-foundation`** |
| P1 | Lazy / inaccurate records, forgotten progress | Capture box (paste, browser dictation, file) → cited proposals (create task, update status/date, progress note) applied by click; server-resolved relative dates (聽日, 下星期五) | **Built on `feat/assistant-foundation`** |
| P2 | No clear priorities | Full Today: ranking, stale-task check-ins, snooze, AI day plan within available hours | **Built on `feat/assistant-foundation`** |
| P3 | Messy files | Multi-file upload, AI title/summary/tags/suggested project, content search that works for Chinese, citation deep links | **Built on `feat/assistant-foundation`** |
| P4 | Don't know how to solve a task | Task approach: cited steps from documents, general-knowledge steps labelled as such | **Built on `feat/assistant-foundation`** |
| P5 | Emails in my tone | Writing-style profile from samples, drafts per task or incoming email, unsupported-fact flags, copy/mailto only | **Built on `feat/assistant-foundation`** |
| P6 | Inputs | Read-only Gmail triage on request, voice-memo transcription | **Built on `feat/assistant-foundation`** |
| P7 | More assistance — a supervised agent | One request may take several tool steps (search documents, read my tasks, draft an email, propose changes); every write is still a proposal the person applies. Bounded steps inside the request, no background runs, no sending. Also: Ask grounded on the asker's own tasks, a labelled general-knowledge mode, remaining pages translated. Requires deliberately revising the "not an agent" rule in CLAUDE.md. | **Agent built on `feat/assistant-foundation`**; the remaining-page translation moves to P8 |
| P8 | Finish the Chinese UI | Translate the older panels still in English (task board and detail, requirements, timeline, risks, plan review, reports, chat, projects, dashboard), and the status labels in `labels.ts` | **Built on `feat/translate-remaining`.** API error messages and the language of generated plans, extractions, and weekly-report narratives remain English — next candidates |
| P9 | Where Hong Kong work happens | WhatsApp chats (export or paste, read in the browser) and Outlook mail (Microsoft Graph, read-only, company and personal accounts; `.eml`/`.msg` drop as the fallback when IT blocks the app) become captures | **WhatsApp built on `feat/whatsapp-capture`**; Outlook next |

---

## Status: ScopePilot core copilot loop implemented

### Shipped after the MVP

| Item | What changed |
|---|---|
| **Conversation memory** | Follow-ups were broken — `answerQuestion` took a bare string and prior turns were never sent to the model. Now the chat route loads prior turns, and `src/lib/rag/rewrite.ts` rewrites the follow-up into a standalone question **before embedding**. |
| **Evaluation metrics** | `/admin/evaluations` stored cases but computed nothing. Now: golden-set expectations (`expectedKeywords`, `shouldRefuse`), deterministic auto-scoring, aggregate metrics (auto pass rate, refusal accuracy, citation rate, latency p50/p95), and a **Re-run all** regression button. |
| **Retry for failed ingestion** | A failed document was permanently stuck — the only `/process` call was on upload. Retry buttons added to the dashboard and the document detail page. |
| **Cited plan generation + Review** | Selected ready documents become bounded, cited draft milestones, tasks, risks, and dependency edges. A human edits and approves/rejects them before official PM reads can see them. |
| **Combined project Q&A** | Project questions ground against document retrieval and deterministic snapshots of official live records in parallel. Global questions stay document-only. |
| **Saved weekly reports** | Exact UTC-window sections and server-derived health are saved with a concise cited narrative, immutable history, and source snapshots. |
| **Requirement register** | Selected documents become cited draft requirements with MoSCoW priority, acceptance criteria, assumptions, and honest confidence. A human validates or rejects each one in the register; approved requirements link to delivery records, and uncovered scope is a computed number rather than a memory. |

Two things worth remembering from that pass:

1. **Prisma drops the pgvector HNSW index on every migration.** Caught before
   applying. It does not break correctness — it silently turns vector search
   into a sequential scan. Now **enforced rather than remembered**:
   `prisma/ensure-vector-index.ts` runs after every migration and exits
   non-zero if the index is missing or built with the wrong operator class.
   See the warning in `CLAUDE.md`.
2. **The rewrite length guard was initially too loose.** `question.length + 400`
   let a 17-character follow-up expand into a 290-character answer. Now
   `max(240, question.length * 3)`. Caught by a test, not by inspection.

---

## Positioning: how this differs from ClickUp AI

The feature categories overlap — answers from your files, status and reports,
drafting, an agent — and on breadth this app does not compete: ClickUp has the
integrations, the team features, the mobile apps, and model choice. It is aimed
instead at **Hong Kong professionals working alone or in a small team** who will
not run a project-management tool, and it is different in four ways:

1. **Nothing to maintain.** Say what happened — typed, pasted, Cantonese voice,
   a forwarded email or WhatsApp chat — and the assistant proposes the tasks and
   updates; one click applies them. ClickUp assumes you live inside ClickUp and
   keep it current.
2. **Every claim has a source, and the AI never acts alone.** Answers cite the
   passage or record, refuse without evidence, and nothing is written without a
   person's click. ClickUp's Super Agents act on their own, around the clock.
3. **Hong Kong language.** Cantonese and code-mixed input become clean written
   Chinese tasks, Traditional characters only, with "聽日" and "下星期五"
   resolved by code.
4. **Inputs from where the work actually is** — WhatsApp and Outlook (P9) —
   rather than from a tool the person has to adopt first.

Gaps that matter to that user and remain open: meeting recording and minutes,
a mobile-first capture, and a measured baseline for Chinese retrieval.

---

## Is this better than pasting a document into Claude?

Worth being honest about, because the answer is *not always*:

| Scenario | Better tool |
|---|---|
| One document that fits in context | **Paste it into Claude.** No chunking loss, no retrieval miss. |
| Hundreds of documents | This. The corpus does not fit, and cost scales with tokens per query. |
| Cost per question | This — ~8 chunks instead of the whole corpus, every time. |
| "Contractor must not see the security runbook" | This. `workspaceId` on every read and write. |
| "Why did it answer that, in March?" | This. Question, chunk IDs, model, latency, and feedback are all persisted. |

The audit trail and access control are the parts a chat window cannot give you.
Retrieval quality is where the engineering is.

## MVP definition of done

| Definition of done | Status |
|---|---|
| Signed-in user can upload a supported document | Done |
| `uploaded → processing → ready`, or a useful `failed` state | Done — both paths verified at runtime |
| Grounded answer with ≥1 valid citation when evidence exists | Done |
| Clear refusal instead of hallucination when unsupported | Done |
| User can view the cited document / source excerpt | Done |
| User can leave answer feedback | Done |
| Evaluation page persists and displays cases | Done |
| Hybrid retrieval handles semantic questions and exact identifiers | Done — vector + PostgreSQL FTS with reciprocal-rank fusion |
| Users can create projects containing separate document libraries | Done — project workspace, targeted upload, reassignment, and safe deletion |
| Chat and evaluations can be restricted to one project | Done — project cases automatically combine document and official live-data grounding |
| Projects track tasks, dependencies, milestones, risks, and a timeline | Done — manual CRUD plus human-approved cited AI proposals |
| Selected project documents can generate a cited, reviewable draft plan | Done — bounded context, structured validation, audit run, atomic drafts |
| Draft/rejected proposals never affect operational project state | Done — one canonical official predicate across PM reads and normal mutations |
| Weekly status reports preserve exact sections and cited history | Done — deterministic snapshot plus model-written narrative only |
| Project documents yield cited draft requirements for human validation | Done — extraction run, opaque labels, uncited proposals dropped, register review |
| Agreed scope is traceable to the work delivering it | Done — `RequirementLink`, uncovered/unvalidated rules, coverage on the overview and in project chat |
| Dashboard surfaces overdue, blocked, and upcoming work | Done — counts and lists share one filter definition |
| Type-check, lint, tests, production build pass | Done |
| README covers setup, env, migrations, pgvector, manual test | Done |

---

## Architecture at a glance

```
upload ─▶ validate ─▶ store blob ─▶ Document(uploaded)
                                        │
                                   [trigger]         ◀── swap point for SQS
                                        ▼
                            runIngestion(documentId)
                    extract ─▶ chunk ─▶ embed ─▶ ┌──────────────────┐
                                                 │ ONE TRANSACTION: │
                                                 │ chunks+vectors   │
                                                 │ + status=ready   │
                                                 └──────────────────┘

project ─▶ documents ─▶ upload / process / manage
    │
question ─▶ rewrite if follow-up ─▶ selected project ─▶ embed ─┬─▶ pgvector search ─┐
           (standalone form is                                  └─▶ full-text search ┤─▶ rank fusion
            what gets embedded)                                         │
                          ┌─ no semantic or lexical evidence ─▶ REFUSE (no model call)
                          │
                          └─▶ label chunks S1..Sn ─▶ LLM ─▶ Zod parse
                                                              │
                                                              ▼
                                              validate citations against S-map
                                              (unknown label ⇒ dropped;
                                               zero valid ⇒ downgrade to refusal)
```

---

## Decision log

| # | Decision | Why |
|---|---|---|
| 1 | Next.js 16 + Prisma 7 + pgvector, npm | Empty repo, so the greenfield branch of the brief applied. npm because no other package manager was installed. |
| 2 | OpenRouter for **both** chat and embeddings | Verified OpenRouter exposes an OpenAI-compatible `/embeddings` endpoint with `openai/text-embedding-3-small`. One key covers both; a second vendor was unnecessary. |
| 3 | `openai/text-embedding-3-small`, 1536 dims | Cheap ($0.02/1M), well-understood, ample for the corpus size. Dimension is baked into the migration. |
| 4 | Auth.js v5 credentials, JWT sessions | Self-hosted, demoable with no third-party account. Credentials requires JWT — DB sessions are incompatible with it. |
| 5 | `passwordHash` on the Auth.js `User` row | Credentials has no password store of its own. Identity stays in one place; app tables reference `userId` only. |
| 6 | Chunk/citation/upload logic is pure | Lets the whole suite run with no DB, network, or API key — so a failing test always means a code defect, never missing infrastructure. |
| 7 | Opaque `S1..Sn` labels instead of real chunk IDs in prompts | Makes fabricated citations structurally detectable rather than merely discouraged, and costs fewer tokens. |
| 8 | Two grounding guards, one of them pre-LLM | The retrieval gate is deterministic and free, and does not depend on the model choosing to behave. |
| 9 | Local disk storage behind `StorageProvider` | Zero setup and zero cost for the MVP; the interface is the seam for S3. **Will not work on Vercel serverless** — see below. |
| 10 | Synchronous ingestion behind `runIngestion(id)` | Simplest thing that works, with the queue seam already in place. |
| 11 | Prisma 7 rather than falling back to v6 | The de-risking spike proved the pgvector round-trip works on v7, so the fallback was unnecessary. |
| 12 | Rewrite follow-ups **before** embedding, not just in the answer prompt | Retrieval embeds the question. Fixing only the answering prompt would leave the vector search matching "what about for Sev-2?" — the subject lives in the previous turn. |
| 13 | Deterministic eval scoring, not LLM-as-judge | A regression suite must give the same verdict for the same output, or a retrieval regression is indistinguishable from judge variance. Cases rules cannot decide return `null` and go to human review. |
| 14 | Rewrite failures fall back to the literal question | A bad rewrite degrades retrieval; a blocked rewrite blocks the answer entirely. Never let an optimisation become a hard dependency. |
| 15 | pgvector index guaranteed by a post-migrate script, not by discipline | The hand-edit-every-migration approach relied on a human remembering, and the failure was silent — a dropped index degrades search to a sequential scan without any error. `prisma/ensure-vector-index.ts` is chained into `db:migrate` and exits non-zero, so the failure becomes loud. It checks `indexdef` rather than mere existence, because a wrong operator class is ignored by Postgres rather than rejected. Uses `pg` rather than `psql` (not installed everywhere) or `docker compose exec` (assumes local Docker). |
| 16 | Reciprocal-rank fusion for hybrid retrieval | Cosine similarity and PostgreSQL text rank have unrelated scales. Rank fusion promotes chunks found by both methods while preserving `RAG_MIN_SCORE` as a semantic threshold and allowing exact lexical evidence independently. |
| 17 | Projects are document-owning knowledge workspaces | Users need a clear container for separate systems, customers, or initiatives. Project IDs are recorded on documents, conversations, and evaluations, while retrieval enforces the selected project inside both SQL paths. |
| 18 | Project deletion uses `SET NULL` | Removing an organizational container must not destroy uploaded documents, chat history, or evaluations. Those records become unassigned and remain recoverable. |
| 19 | Project-management records **cascade** on project delete | `Task`, `Milestone`, `ProjectRisk`, and `GenerationRun` have a non-nullable `projectId`, so `SET NULL` is not available and an orphaned task would be unreachable in every view. The delete confirmation names the counts, and documents still survive as unassigned — see invariant 9. |
| 20 | Project tabs are nested routes, not client-side tab state | Each tab fetches only its own data, is linkable, and gets one shared `loading.tsx`. The cost is that layouts cannot pass data down, solved by React `cache` in `src/lib/pm/project.ts`. |
| 21 | All date/status logic is pure, in `src/lib/pm/rules.ts` | "Overdue" and "blocked" appear on a dashboard card, a project overview, and a timeline bucket. One definition, directly unit-testable, means a count and the list beneath it cannot disagree — the same reasoning as chunking and citation validation. |
| 22 | Update schemas carry no Zod defaults | `.partial()` does **not** strip `.default()`. A defaulted field materialises on a PATCH and silently overwrites a value the caller never mentioned — caught by a test that asserted `{ status }` should not also set `priority`. `optionalText` keeps `undefined` (leave alone) distinct from `null`/`""` (clear) for the same reason. |
| 23 | Generated work uses an explicit official-record predicate | Manual/not-applicable and AI/approved are the only operational records. The same helper is used by boards, timelines, summaries, reports, dependency candidates, and live chat grounding so draft leakage is testable in one place. |
| 24 | Sidebar replaces the top nav; app shell is full width | The board and Gantt need horizontal room, and `max-w-5xl` was squeezing five columns into ~180px each. The sidebar also carries project sections, so the tab strip was removed — two navigation systems disagree about where you are. |
| 25 | `Task.startDate` added | A Gantt bar needs a duration. Without a start date a task has a deadline only, and any bar length would be invented. Nullable, so a due-date-only task honestly renders as a point rather than a fabricated span. |
| 26 | Gantt built from a pure geometry module, no charting library | `src/lib/pm/gantt.ts` returns offsets and widths as percentages, so the chart is plain CSS — no measurement, no layout effects, no bundle cost, and the arithmetic is unit-testable instead of buried in JSX. |
| 27 | Drag-and-drop uses native HTML5 events | One status change per drop does not justify a dependency. The drop handler reads the id from `dataTransfer` rather than React state, because state set in `dragstart` is not guaranteed committed when `drop` fires — a bug found in browser testing. The status `<select>` remains as the accessible path. |
| 28 | Plan generation is an audited proposal transaction | A `processing` run exists before the provider call; opaque cited output is normalized before one transaction writes drafts, links, dependencies, and citations. Review is the only path to approval. |
| 29 | Weekly reports split facts from prose | UTC windows, exact sections, counts, and health are deterministic. The model writes only the concise cited narrative, so it cannot omit a blocker or invent a date. |
| 30 | Requirements carry **two** status axes, not one | `generationStatus` answers "did a human accept this record?", `status` answers "is this agreed scope?". Collapsing them loses the distinction the register exists for: a manually typed requirement is a legitimate record *and* an unagreed draft, and an AI proposal a reviewer moved to `needs_clarification` has been kept without being agreed. Baselined scope requires both, in one builder, so a card's count and the list beneath it cannot disagree. |
| 31 | The register shows drafts; the Review page does not | Extends invariant 10 rather than breaking it. A draft task has no operational meaning. A draft requirement — "we think they asked for this, unconfirmed" — is precisely what a consultant works from, and `needs_clarification` is the list of things to take back to the client. Hiding it in run history would delete the feature's value. Two reads (the register page and its collection GET) and one item PATCH are the documented exceptions; every operational read still uses the baselined predicate. |
| 32 | `RequirementLink` uses three nullable FKs, not `targetId` | A `targetType` + opaque id pair has no referential integrity, so deleting a task would leave a link the coverage query still counts. Real FKs cascade; a hand-written CHECK keeps the discriminator and the columns in agreement. Still one table, so Phase 3's matrix needs no migration or backfill. |
| 33 | `sequence Int` rather than a stored `REQ-001` string | Traceability needs stable human-readable keys, but a stored string sorts wrong past 999 and freezes the format forever. The integer sorts correctly and `formatRequirementCode()` is the single place the rendering lives. |
| 34 | A new `GenerationRunType` value gets its own migration file | Postgres refuses to use an enum value in the transaction that added it, and Prisma wraps each migration file in one. The partial unique index for active requirement runs references `'requirements'`, so the `ALTER TYPE` had to ship separately. The earlier `GenerationRunStatus` addition survived in one file only because nothing referenced its new value — not precedent. |
| 35 | Extraction reuses the plan pipeline instead of forking it | Citation resolution, the S-label context builder, the audit lifecycle, and the single JSON repair attempt were already correct and tested. The only flow-specific part was the retrieval probes, so `selectDocumentContext` takes its queries as an argument — the second implementation that justifies the parameter. |
| 36 | Pivot to a personal work assistant; discovery and delivery become optional layers | The user's pain points are personal workload (recording, priorities, files, progress, email), not scope agreement. Tasks moved into the core tabs; `discoveryEnabled` was added beside `deliveryEnabled` and backfilled to `true` for every existing project, so nobody lost a tab they worked in. Both still gate navigation only. |
| 37 | "Today" is UTC midnight of the viewer's local date, passed where `now` was | Every rule already compares UTC days, so changing the anchor instead of the rules keeps one definition of overdue. Applied to every page that counts overdue work at once — Today alone would disagree with the board between 00:00 and 08:00 HKT. Instants keep the real clock. |
| 38 | No i18n library; typed dictionaries, locale as a user preference | Every page is behind sign-in, so a locale URL segment buys nothing. `satisfies Dictionary` makes a missing key a type error; a test rejects Simplified characters, the error a reviewer is most likely to miss. |
| 39 | In a workspace of one, unassigned tasks are "mine" | Existing tasks mostly have no assignee. Requiring one would have opened Today empty for the only user; with colleagues, unassigned work is nobody's yet and stays out. |
| 40 | Personal project per person, hidden from colleagues' navigation rather than private | A captured task needs a home when no project is named, and statuses are per project, so a nullable `Task.projectId` would have touched every query. Real privacy would need project-level ACLs everywhere; hiding keeps the workspace as the single security boundary and puts private data (captures, Gmail text) in per-user tables instead. |
| 41 | `User.activeWorkspaceId` instead of "earliest membership" | With invites, an existing user who joins a team would otherwise never see the team workspace. The column is only a preference; membership is re-checked on every request. |
| 42 | Invite tokens hashed, single-use, accepted by POST | A link is a bearer credential. Hashing makes a leaked row useless, the conditional claim admits one person, and a POST means a mail client's link preview cannot join anyone. |
| 43 | Capture proposals are rows applied through the manual write path, not AI draft records | Draft AI records need a project-scoped `GenerationRun`, are invisible to every operational read, and cannot express "mark that task done" or "add a note". A proposal row can, and a conditional claim in the write's transaction makes Apply idempotent. Extracting `task-write.ts` keeps one validation path for typed and captured tasks. |
| 44 | The date phrase, not the date, is what the model returns | "聽日" and "下星期五" are where models slip — off by a day, or a guessed year. A pure resolver anchored on the capture's stored local date is testable and stable across retries; the model's own date only raises a flag. |
| 45 | A capture is not stored as a document | A document is workspace-visible and chat evidence; a person's notes (and later their email) are private, and unreviewed notes behind a citation would be the problem `TaskComment` already avoids. Ingestion would also spend the 60-second budget before the model call. |
| 46 | OpenCC (`opencc-js@1.4.2`) converts model prose to Hong Kong Traditional | A prompt rule makes Simplified rare, not impossible. Conversion runs after validation and never touches quotes; the Simplified detector excludes the forms OpenCC's HK standard itself produces (户, 脱), so the two agree. |
| 47 | Staleness is computed from loaded rows, not a query builder | Today already loads every open task of the viewer's, so one pure `isStale()` over those rows gives the badge, the section, and the planner's "quiet" fact from a single definition. A `*Where` twin would be a second definition to keep in step. |
| 48 | Snooze is its own table; "still working" writes `checkedInAt` | A snooze says nothing happened, so it must not move `updatedAt`; a check-in says something did, so it should. Keeping the two apart is what stops the reminder from being silenced by accident. |
| 49 | The day plan is stored but never writes to tasks | Re-opening Today should not pay for another model call, and finished work should tick off as the day goes; both come from saving the order and joining live status on read. Ordering is advice, so it stays out of the task records entirely. |
| 50 | Document search uses `ILIKE` over passages, not the full-text index | The `english` text-search configuration cannot segment Chinese, so a Chinese phrase would never match lexically. A substring match needs no segmentation. It scans the workspace's passages; add a `pg_trgm` GIN index when a workspace grows large enough to feel it. The grounding path is unchanged. |
| 51 | Labelling is a separate request after indexing, and a person's edit is final | Indexing must fit the 60-second limit on its own. A summary that states facts is held to the citation rule; a title and tags are filing aids. Overwriting a person's correction with the next AI pass would teach them not to correct anything. |
| 52 | `storeDocument()` is the only way bytes become a Document | A second, server-side path (saving a capture) appeared; keeping validation and the id-based storage key in one function means it cannot skip either (invariant 6). |
| 53 | Task approaches may answer without evidence; nothing else may | Refusing "how do I tackle this?" whenever the files are silent would leave the person exactly as stuck as before. The guard moves from refusing to labelling: a step's basis is computed from valid citations, never taken from the model, and general steps stay visibly marked wherever they are copied. |
| 54 | A step becomes a task at most once | `createdSteps` is claimed with `NOT has` + `push` in the task's transaction — the same conditional-claim idea as capture proposals and invite links, without a table per step. |
| 55 | Email drafts never send, and facts are checked rather than trusted | Sending from the app would make it a system that acts on the outside world, which it is not. The fact check flags rather than strips, because the person may know a date the inputs omitted — the goal is that nothing reaches a client unread. |
| 56 | Writing style is per person, not per workspace | A voice belongs to the person and follows them between workspaces; nobody else's drafts may borrow it. |
| 57 | Gmail through our own OAuth flow, not Auth.js | Sign-in stays Credentials; Gmail is a separate, revocable, read-only grant. A table of our own (`IntegrationAccount`) keeps the encrypted refresh token out of Auth.js's `Account` table, which would collide if Google sign-in is ever added. |
| 58 | Voice memos become WAV in the browser | OpenRouter's audio input lists wav, mp3, aac, ogg, flac, m4a, and PCM, not webm — and webm is what Chrome records. Decoding and resampling client-side also shrinks a minute to ~1.9 MB, so segments fit Vercel's limits without a server-side encoder. |
| 59 | One supervised agent, fenced inside a request (user decision, 2026-10-16) | The person asked for help that takes several look-ups ("prepare me for tomorrow's meeting"). A bounded loop inside one request gives that without the risks of an autonomous agent: a step cap and a time limit, tools that only read or save a draft, opaque labels, and every change returned as a proposal through the capture validator and the shared write path. |
| 60 | JSON steps instead of native tool calling | Works with any JSON-mode model (the configured model may not support tools well), keeps the provider contract a plain string, and makes the loop replayable in tests with a scripted fake. |
| 61 | `applyChange` takes the claim as a hook | Capture and assistant proposals live in different tables but must write identically; the claim-and-record hooks are the only difference, so there is one write path to keep correct. |
| 62 | Dictionaries split by area, one type over all of them | One 3,000-line file per language was unreviewable. Area files spread into the roots keep `satisfies Dictionary` and the key-parity test covering everything, with no runtime loading. |
| 63 | Exports and client packs pick their own language | A Hong Kong consultant may work in Chinese and send an English pack, or the reverse. `?lang=` and a link on the print page cost one parameter; tying the file to the UI language would force a settings change per client. Client text inside the file is never translated. |

### Deviations from the original spec (approved)

- `ChatMessage.modelName` and `ChatMessage.retrievedChunkIds` added — the spec's
  logging requirement asks to inspect selected chunk IDs and model name, which
  the listed fields could not hold.
- `Document.extractedText` and `Document.chunkCount` added — cached for the
  detail page so it need not re-parse the original file.
- `EvaluationCase` also stores `confidence`, `latencyMs`, `modelName`.

---

## Known limitations

1. **Refusal threshold is only lightly validated.** `RAG_MIN_SCORE=0.25` was
   confirmed against live `text-embedding-3-small` on one corpus: a genuine
   match scored 0.668 and an unrelated question refused correctly. That is one
   data point, not a calibration. Add unanswerable cases to the evaluation
   suite and watch `refusalAccuracy` as the corpus grows. The lexical path is
   an independent grounding signal, but the semantic floor still needs tuning.
1a. **Keyword scoring is strict, and model wording varies.** A live back-to-back
   regression run moved `autoPassRate` from 0.67 to 0.33 with no code change:
   the same question answered correctly both times, but one run omitted a
   required keyword. `temperature: 0` reduces variance, it does not remove it.
   Practical guidance: use **few, essential** keywords — an identifier, a
   command, a number — never a phrase the model could legitimately paraphrase.
   `shouldRefuse` cases are far more stable and are the better regression
   signal. Treat a single-point pass-rate drop as noise; treat a
   `refusalAccuracy` drop as real.

2. **Synchronous ingestion.** A large PDF blocks its request. Fine for the MVP,
   and the reason the queue seam exists.
3. **Local disk storage** rules out Vercel serverless deployment as-is.
   3a. **A follow-up costs two model calls** (rewrite + answer). Acceptable for
   the quality gain, but it is the obvious thing to cache if cost matters.
4. **No OCR.** Scanned/image-only PDFs produce no text and fail with a clear
   message rather than silently indexing nothing.
5. **Invites are links, not emails.** An admin copies a single-use link and
   sends it themselves; the app sends no mail. There is no per-document or
   per-project access control inside a workspace — a personal project is only
   hidden from navigation.
6. **No chat history UI.** Conversations and messages are persisted, and
   follow-ups now work within a session, but the chat page shows only the
   current session and there is no way to reopen a past conversation.
7. **`next-auth@5.0.0-beta.32`** is beta-tagged. Verified compatible with Next 16
   and React 19; the risk is API churn on upgrade, not breakage today.
8. **Chinese retrieval is semantic-only, and the threshold is unmeasured for
   it.** The lexical path uses the `english` text-search configuration, which
   does not segment Chinese, so a Chinese question is grounded only if its
   cosine similarity clears `RAG_MIN_SCORE` — a value calibrated on one English
   corpus. Add Traditional Chinese answerable/unanswerable evaluation cases and
   record a baseline before changing either (P3 adds `ILIKE` *search*, which is
   not the grounding path).
9. **Gmail needs a Google Cloud OAuth client, and a personal account expires
   weekly.** A gmail.com account can only use an app in Testing mode, whose
   grants Google ends after 7 days; the page then asks for a reconnect. A
   Google Workspace organisation can mark the app Internal and avoid both the
   expiry and Google's verification. Public use would need restricted-scope
   verification.

---

## Enhancement roadmap

Ranked by how much each moves the project past "an LLM with a vector database
bolted on". Items 1–4 are shipped; 5–8 remain roadmap work.

| # | Item | Status | Why it matters |
|---|---|---|---|
| 1 | Evaluation metrics + regression suite | **Shipped** | Anyone can wire an LLM to a vector DB. Being able to say *"refusal accuracy is 0.95, here's the suite that catches regressions"* is the part that is actually engineering. It also makes every item below measurable instead of vibes. |
| 2 | Conversation memory with query rewriting | **Shipped** | Was the single biggest reason the app felt worse than a chat window. |
| 3 | Retry for failed ingestion | **Shipped** | Small, but a stuck document with no recovery is an obvious rough edge. |
| 4 | **Hybrid search** (pgvector + Postgres full-text) | **Shipped** | Dense embeddings are weak on exact identifiers. Reciprocal-rank fusion preserves semantic recall while promoting exact project terms. |
| 5 | Streaming responses | Next | ~2.7s of spinner reads as broken. Cheap, disproportionate perceived-quality gain. |
| 6 | Cross-document synthesis | Later | *"Which runbooks mention Redis, and do they conflict?"* The question you genuinely cannot answer by pasting one file. Needs retrieval that spreads across documents rather than concentrating in the best-matching one. |
| 7 | Re-ranking (top ~30 → ~8) | Later | Cheap recall win once there is enough corpus for `RAG_TOP_K=8` to be the binding constraint. Measure with item 1 first. |
| 8 | Chat history UI | Later | Conversations and messages are already persisted; only the UI is missing. |

**Do not start item 4, 6, or 7 without a baseline evaluation run.** That is the
entire reason item 1 was built first.

---

## Next steps, roughly in order

**Immediately after adding a real `OPENROUTER_API_KEY`**
- Run the manual RAG walkthrough in the README end to end.
- Calibrate `RAG_MIN_SCORE` (see limitation 1).
- Add 5–10 evaluation cases covering both answerable and unanswerable questions,
  then record the baseline metrics before changing anything.

**Phase 2 — asynchronous ingestion (the designed-for migration)**
1. Add an `S3StorageProvider` implementing `StorageProvider`; switch the factory
   in `src/lib/storage/index.ts`. No call site changes.
2. Change `POST /api/documents/[id]/process` to enqueue an SQS message instead
   of awaiting.
3. Add a Lambda consumer that calls the **unchanged** `runIngestion(documentId)`.
4. Add a dead-letter queue; surface exhausted retries as `status='failed'`.

The UI already polls for status, so no frontend work is required.

**Phase 3 — retrieval quality**
- Re-ranking the top ~30 candidates down to ~8.
- Switch IVFFlat/HNSW parameters once the corpus is large enough to matter.

Completed in Phase 3:
- Hybrid search using pgvector + PostgreSQL full-text search for exact
  identifiers, merged with reciprocal-rank fusion.

**Phase 4 — business knowledge organization**
- Document collections and metadata: team, system, environment, location,
  document type, owner, effective date, and review date.
- Document lifecycle states, version relationships, expiry warnings, and
  conflict detection.
- User-triggered operational templates for incident checklists, handovers,
  change-impact reviews, audit summaries, and onboarding guides.

Completed in Phase 4:
- Project workspaces that contain their own documents, project-targeted uploads,
  cross-project reassignment, and project-scoped chat and evaluations.

**Completed Phase 4b — document-grounded project generation and delivery loop**

The citation guarantees extend rather than fork:

1. Keep `S1..Sn` for document chunks and give structured records their own
   disjoint opaque labels. Real database IDs still never reach the model; only
   the source map's value type widens to a discriminated `{ kind, id }`.
2. Keep **one** validation gate. `validateAnswer` resolves every returned label
   through that single map and drops anything absent, so no new path can bypass
   it. A proposal left with zero valid citations is discarded, mirroring the
   existing zero-citation downgrade to a refusal.
3. Structured records are fetched by workspace- and project-scoped queries, so
   they are grounding evidence by construction and need no threshold.
   `RAG_MIN_SCORE` keeps its exact meaning because it still applies only to
   `RetrievedChunk.score`. The pre-model refusal gate becomes: refuse unless
   retrieval supplied a qualifying chunk *or* the project-data query returned an
   in-scope record — deterministic on the structured half, so the gate gets
   stronger.
4. Record the run in `GenerationRun`, write proposals as
   `source: ai_suggested, generationStatus: draft`, and require an explicit human
   action to approve. Nothing writes to a project without a click.
5. Store the chat scope (`documents | project_combined`) on
   `ChatConversation` and start a fresh conversation when it changes, the same
   rule `projectId` already follows.
6. Build weekly facts deterministically from official records, then ask the
   model only for a cited narrative and persist the complete immutable snapshot.

**Phase 5 — knowledge health and collaboration**
- Dashboard for refusals, low-confidence topics, feedback trends, frequently
  cited documents, unused documents, and documentation gaps.
- Workspace invitations, role management, and document-level access control.
- Conversation history, saved answers, internal sharing, and cited exports.
