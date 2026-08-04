# AI Ops Copilot

An internal knowledge assistant for IT operations teams. Create project
workspaces, upload each project&apos;s runbooks, incident reports, and policies,
then ask questions in plain English and get answers assembled **only** from the
selected documents — with citations you can open and verify.

When the documents don't cover something, it says so instead of inventing an
answer.

> This is a retrieval-augmented generation (RAG) workflow, not an autonomous
> agent. It answers questions; it does not take actions on external systems.

## Features

- Project workspaces with separate document libraries and project-scoped chat
- Upload PDF, DOCX, Markdown, TXT, or CSV, validated by extension, MIME type, **and** magic bytes
- Text extraction that preserves page numbers (PDF) and headings (DOCX/Markdown)
- Chunking that carries document, page, section, and position metadata into every citation
- Hybrid pgvector + full-text search, scoped to the workspace and selected project on every query
- Answers returned as structured JSON: answer, confidence, and citations
- Citations validated server-side — the model cannot cite a source it was never given
- Thumbs up/down feedback on every answer
- An evaluation page for recording question / expected / actual / pass-fail with latency

---

## Local setup

### Prerequisites

- Node.js 20+ (developed on v24)
- Docker (for PostgreSQL + pgvector)
- An [OpenRouter API key](https://openrouter.ai/keys)

### 1. Install and configure

```bash
npm install
cp .env.example .env
```

Generate an auth secret and paste it into `.env` as `AUTH_SECRET`:

```bash
openssl rand -base64 32
```

Then set `OPENROUTER_API_KEY` in `.env` to your real key.

### 2. Start PostgreSQL with pgvector

```bash
npm run db:up
```

This starts `pgvector/pgvector:pg17` on port 5432 with pgvector preinstalled —
no manual extension build required. The initial migration runs
`CREATE EXTENSION IF NOT EXISTS vector;` before creating the vector column.

### 3. Run migrations

```bash
npm run db:migrate
```

This runs `prisma migrate deploy` followed by `prisma generate`. Prisma 7 no
longer generates the client automatically after migrating, which is why both are
chained.

### 4. Seed a demo account (optional)

```bash
npm run db:seed
```

Creates `demo@example.com` / `demo-password-123`. You can also register a new
account from the sign-in page — a workspace is provisioned automatically on
first use.

### 5. Start the app

```bash
npm run dev
```

Open <http://localhost:3000>.

---

## Environment variables

All are server-side only. None are exposed to the browser.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string; matches `docker-compose.yml` |
| `AUTH_SECRET` | — | Session signing key (`openssl rand -base64 32`) |
| `AUTH_URL` | `http://localhost:3000` | Base URL for auth callbacks |
| `OPENROUTER_API_KEY` | — | **The only real secret required** |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Provider endpoint |
| `OPENROUTER_CHAT_MODEL` | `anthropic/claude-haiku-4.5` | Answer generation |
| `OPENROUTER_EMBEDDING_MODEL` | `openai/text-embedding-3-small` | Embeddings |
| `EMBEDDING_DIMENSIONS` | `1536` | **Must match the `vector(N)` column** |
| `STORAGE_DIR` | `./storage` | Where uploaded files are written |
| `MAX_UPLOAD_BYTES` | `10485760` | 10 MB upload cap |
| `RAG_TOP_K` | `8` | Hybrid-ranked chunks retrieved per question |
| `RAG_MIN_SCORE` | `0.25` | Minimum semantic similarity; exact full-text matches are also valid evidence |

`.env.example` contains placeholder names only — never commit real keys.

### Changing the embedding model

`EMBEDDING_DIMENSIONS` must equal the `vector(N)` column created in
`prisma/migrations/*/migration.sql`. Switching to a model with a different
dimension requires a **new migration and re-embedding every existing chunk**.

---

## Testing the RAG flow manually

With the app running and a real `OPENROUTER_API_KEY` set:

1. **Sign in** at `/login` (register, or use the seeded demo account).

2. **Create a project** at `/projects`. Creating it opens the project workspace.

3. **Upload a document inside the project.** Try this as `runbook.md`:

   ```markdown
   # Sev-1 Database Outage Runbook

   ## Escalation Path
   For a Sev-1 database outage, page the on-call DBA immediately via PagerDuty.
   If there is no acknowledgement within 10 minutes, escalate to the Director of
   Infrastructure.

   ## Recovery Steps
   Confirm the primary is down with `pg_isready -h primary.db`. If unreachable,
   promote the standby using `repmgr standby promote`. Maximum acceptable data
   loss is 30 seconds of write-ahead log.
   ```

4. **Watch the status** go `uploaded → processing → ready`. The project polls
   automatically. A document is only marked ready once its chunks and embeddings
   are committed — if anything fails you get a `failed` badge with the reason.

5. **Click “Ask this project”** and ask an answerable question:
   > How do I promote the standby database during an outage?

   Expect a grounded answer, a confidence badge, and at least one citation
   showing the filename, section, and a source excerpt.

6. **Ask an unanswerable question**:
   > What is the vacation policy for marketing interns in Lisbon?

   Expect *"I couldn't find this in the uploaded documents."* — **not** a
   fabricated answer. If you instead get a made-up answer, raise `RAG_MIN_SCORE`
   (see tuning note below).

7. **Click a citation** to open `/documents/[id]` and check the extracted text
   and indexed chunks against the original.

8. **Leave feedback** with the thumbs buttons.

9. **Record an evaluation** at `/admin/evaluations`: select its project scope,
   enter a question and what a correct answer should mention, run it, then mark
   it pass or fail. Project, latency, model name, and retrieved chunk IDs are
   stored with each case.

### Tuning the refusal threshold

`RAG_MIN_SCORE` defaults to `0.25`, which is a starting guess. Ask several
questions you know your documents cannot answer and raise the value until they
reliably refuse. Too low and unrelated chunks get through; too high and valid
semantic questions get refused. Exact full-text matches are evaluated
independently, so identifiers such as hostnames and error codes do not depend
on dense-vector similarity alone.

---

## How grounding is enforced

Two independent guards, so neither depends on the model behaving well:

1. **Retrieval gate (before the model is called).** Vector and PostgreSQL
   full-text candidate rankings are fused. If no chunk clears
   `RAG_MIN_SCORE` and no chunk matches the full-text query, the refusal is
   returned immediately without spending a model request. Deterministic and
   free.

2. **Citation whitelist (after the model replies).** Retrieved chunks are
   labelled `S1…Sn` in the prompt — real database IDs are never sent to the
   model. Returned identifiers are resolved through a server-side map, and
   anything not in it is dropped. An answer left with no valid citation is
   downgraded to a refusal, because an uncitable claim is exactly the shape a
   hallucination takes.

Every answer stores the question, retrieved chunk IDs, model name, latency, and
any user feedback, so answers can be audited after the fact.

---

## Commands

```bash
npm run dev          # development server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest — no database, network, or API key required
npm run db:up        # start Postgres + pgvector
npm run db:down      # stop it
npm run db:migrate   # migrate deploy + generate
npm run db:seed      # seed the demo account
npm run db:studio    # Prisma Studio
```

---

## Project structure

```
prisma/
  schema.prisma            data model (Unsupported("vector(1536)") for embeddings)
  migrations/              pgvector/HNSW, full-text GIN, and project layer
src/
  app/
    (app)/                 projects, project documents, chat, all documents, admin
    api/                   route handlers — all Zod-validated and workspace-scoped
  lib/
    auth.ts auth-guard.ts  Auth.js config; requireWorkspace / requireAdmin
    db.ts                  Prisma client (PrismaPg adapter) + vector serialisation
    env.ts                 lazily validated server env
    providers/             EmbeddingProvider / ChatProvider + OpenRouter impl
    storage/               StorageProvider + local-disk impl
    ingest/                validate-upload, extract, chunk, pipeline
    rag/                   hybrid retrieve/ranking, prompt, citations, answer
tests/                     vitest — chunking, citations, retrieval, access, refusals, uploads
```

See [CLAUDE.md](CLAUDE.md) for invariants and conventions, and
[PLANNING.md](PLANNING.md) for the decision log and roadmap.

---

## Deployment note

The default `StorageProvider` writes to local disk, which does **not** work on
Vercel serverless (read-only filesystem). To deploy there, add an S3/R2 adapter
implementing `put`/`get`/`delete` in `src/lib/storage/` and switch the factory in
`src/lib/storage/index.ts` — no other code changes are needed.
