# PLANNING.md

Living plan and decision log for ScopePilot — AI Project Delivery Copilot.

---

## Goal

A secure, single-workspace requirements-discovery and delivery assistant: create
project workspaces, upload source documents, extract reviewable cited
requirements and reviewable cited plans, trace agreed scope to the work that
delivers it, and ask questions grounded in documents and approved live project
records.

**Explicitly out of scope**, now and later unless deliberately revisited:
multi-agent orchestration, autonomous loops, external tool calling, ServiceNow
integration, or any action that modifies an external system. This is retrieval
and generation — it answers questions, it does not act.

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
5. **Single workspace per user**, auto-provisioned. `WorkspaceMember` and roles
   are modelled, but there is no invite flow yet.
6. **No chat history UI.** Conversations and messages are persisted, and
   follow-ups now work within a session, but the chat page shows only the
   current session and there is no way to reopen a past conversation.
7. **`next-auth@5.0.0-beta.32`** is beta-tagged. Verified compatible with Next 16
   and React 19; the risk is API churn on upgrade, not breakage today.

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
