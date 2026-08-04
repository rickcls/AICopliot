# PLANNING.md

Living plan and decision log for AI Ops Copilot.

---

## Goal

A secure, single-workspace MVP of an internal knowledge assistant for IT
operations teams: upload operational documents, ask questions, get answers
grounded strictly in those documents with verifiable citations.

**Explicitly out of scope**, now and later unless deliberately revisited:
multi-agent orchestration, autonomous loops, external tool calling, ServiceNow
integration, or any action that modifies an external system. This is retrieval
and generation — it answers questions, it does not act.

---

## Status: MVP complete + first enhancement pass shipped

### Shipped after the MVP

| Item | What changed |
|---|---|
| **Conversation memory** | Follow-ups were broken — `answerQuestion` took a bare string and prior turns were never sent to the model. Now the chat route loads prior turns, and `src/lib/rag/rewrite.ts` rewrites the follow-up into a standalone question **before embedding**. |
| **Evaluation metrics** | `/admin/evaluations` stored cases but computed nothing. Now: golden-set expectations (`expectedKeywords`, `shouldRefuse`), deterministic auto-scoring, aggregate metrics (auto pass rate, refusal accuracy, citation rate, latency p50/p95), and a **Re-run all** regression button. |
| **Retry for failed ingestion** | A failed document was permanently stuck — the only `/process` call was on upload. Retry buttons added to the dashboard and the document detail page. |

Two things worth remembering from that pass:

1. **Prisma drops the pgvector HNSW index on every migration.** Caught before
   applying. It does not break correctness — it silently turns vector search
   into a sequential scan. See the warning in `CLAUDE.md`.
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

question ─▶ rewrite if follow-up ─▶ embed ─▶ pgvector search (workspace-scoped)
           (standalone form is           │
            what gets embedded)          ├─ nothing ≥ RAG_MIN_SCORE ─▶ REFUSE
                                         │                        (no model call)
                                         └─▶ label chunks S1..Sn ─▶ LLM ─▶ Zod
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
   suite and watch `refusalAccuracy` as the corpus grows.
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
bolted on". Items 1–3 are shipped; 4–8 are not.

| # | Item | Status | Why it matters |
|---|---|---|---|
| 1 | Evaluation metrics + regression suite | **Shipped** | Anyone can wire an LLM to a vector DB. Being able to say *"refusal accuracy is 0.95, here's the suite that catches regressions"* is the part that is actually engineering. It also makes every item below measurable instead of vibes. |
| 2 | Conversation memory with query rewriting | **Shipped** | Was the single biggest reason the app felt worse than a chat window. |
| 3 | Retry for failed ingestion | **Shipped** | Small, but a stuck document with no recovery is an obvious rough edge. |
| 4 | **Hybrid search** (pgvector + Postgres full-text) | Next | Dense embeddings are weak on exact tokens — `ORA-01555`, `primary.db`, CVE IDs. Cosine similarity understands *meaning*, not *string identity*. Highest-value retrieval fix for an IT-ops corpus. |
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
- Hybrid search (pgvector + Postgres full-text) for exact identifiers like
  hostnames and error codes, where dense embeddings are weak.
- Re-ranking the top ~30 candidates down to ~8.
- Switch IVFFlat/HNSW parameters once the corpus is large enough to matter.

**Phase 4 — multi-user workspaces**
- Invite flow, role management UI, per-document access control.
