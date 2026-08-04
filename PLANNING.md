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

## Status: MVP complete

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

question ─▶ embed ─▶ pgvector search (workspace-scoped)
                          │
                          ├─ nothing ≥ RAG_MIN_SCORE ──▶ REFUSE (no model call)
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

### Deviations from the original spec (approved)

- `ChatMessage.modelName` and `ChatMessage.retrievedChunkIds` added — the spec's
  logging requirement asks to inspect selected chunk IDs and model name, which
  the listed fields could not hold.
- `Document.extractedText` and `Document.chunkCount` added — cached for the
  detail page so it need not re-parse the original file.
- `EvaluationCase` also stores `confidence`, `latencyMs`, `modelName`.

---

## Known limitations

1. **Refusal threshold is untuned against real embeddings.** `RAG_MIN_SCORE=0.25`
   is a starting guess. The two grounding guards are proven by unit tests, but
   the *numeric* threshold should be calibrated once real embeddings are in
   play — ask several questions you know are unanswerable and raise the floor
   until they refuse. This is the single most important post-key task.
2. **Synchronous ingestion.** A large PDF blocks its request. Fine for the MVP,
   and the reason the queue seam exists.
3. **Local disk storage** rules out Vercel serverless deployment as-is.
4. **No OCR.** Scanned/image-only PDFs produce no text and fail with a clear
   message rather than silently indexing nothing.
5. **Single workspace per user**, auto-provisioned. `WorkspaceMember` and roles
   are modelled, but there is no invite flow yet.
6. **No chat history UI.** Conversations and messages are persisted, but the
   chat page shows only the current session.
7. **`next-auth@5.0.0-beta.32`** is beta-tagged. Verified compatible with Next 16
   and React 19; the risk is API churn on upgrade, not breakage today.

---

## Next steps, roughly in order

**Immediately after adding a real `OPENROUTER_API_KEY`**
- Run the manual RAG walkthrough in the README end to end.
- Calibrate `RAG_MIN_SCORE` (see limitation 1).
- Add 5–10 evaluation cases covering both answerable and unanswerable questions.

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
