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
- **Project management inside each workspace** — a drag-and-drop Kanban board,
  task dependencies, milestones, and risks
- **Gantt timeline** showing tasks and milestones against a date axis, with a
  today marker and overdue highlighting
- **Workspace dashboard** showing active projects, overdue tasks, blocked tasks,
  and upcoming milestones
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

Creates `demo@example.com` / `demo-password-123`, plus a sample project with
tasks, dependencies, milestones, and risks so the board, timeline, and dashboard
have something to show before you upload anything. You can also register a new
account from the sign-in page — a workspace is provisioned automatically on
first use.

Re-running is safe: the user is upserted and the demo project is skipped once
the workspace already has one.

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

## Testing project management manually

No API key or model call is involved — this works on a fresh database.

1. **Open a project** and use the **Tasks** section. Create a task with a
   priority, assignee, start and due date, and an estimate. **Drag it between
   columns** — it should move immediately and stay put. Then open its detail
   panel and change the status from the dropdown instead.

2. **Add a dependency** from the detail panel. Confirm the three rejections:
   the task itself is not offered in the list; adding the same dependency twice
   returns *"That dependency already exists"*; a task from another project is
   never offered and is rejected server-side if forced.

3. **Set a due date in the past** and check the **Timeline** — it appears under
   *Overdue*, in red, and its Gantt bar turns red. A task due **today** must
   appear under *Next 7 days*, not *Overdue*.

4. **Give one task a start date and leave another with only a due date.** The
   first draws a bar, the second a small marker. Try setting a start date after
   the due date — it is rejected on both the form and the API.

5. **Add a milestone** from the Timeline, with and without a target date. The
   undated one is listed under the chart rather than disappearing.

6. **Record a risk** on the **Risks** section with impact, likelihood, and a
   mitigation, then change its status to Mitigated.

7. **Check `/dashboard`** — the summary counts should match what you just
   entered. **`/documents`** holds the cross-project document library and is
   unaffected by any of it.

8. **Delete the project** from `/projects`. The confirmation names how many
   documents become unassigned and how many tasks, milestones, and risks are
   permanently deleted. Confirm, then check that the documents still exist on
   `/documents` as unassigned.

---

## Project management

Each project is both a knowledge container and a place to track the work its
documents describe. Open a project and use the tabs:

Navigation lives in the left sidebar: global links at the top, and the sections
of whichever project you are in below it.

| Section | What it does |
|---|---|
| **Overview** | Open, overdue, blocked, and risk counts; overdue tasks, upcoming milestones, and document readiness at a glance |
| **Tasks** | Kanban board — Backlog, To do, In progress, Blocked, Done. **Drag a card between columns** to change its status; click a card for the detail panel |
| **Timeline** | A **Gantt chart** of tasks and milestones, then what is overdue, due in the next 7 days, and later — plus milestone management |
| **Documents** | The project's document library (unchanged) |
| **Risks** | Impact, likelihood, mitigation, and status for each recorded risk |

Task cards show a priority stripe, assignee, due date (red when overdue),
estimate, and dependency count. Everything else — description, dates,
dependencies, sources, edit, and delete — lives in the detail panel, so cards
stay readable. Moving a card is optimistic and rolls back if the server rejects
it. Dragging is never the only way: the detail panel has a status dropdown.

Dependencies are added from the detail panel. A task cannot depend on itself,
cannot depend on a task in another project, and cannot have the same dependency
twice — the API rejects all three, and a database `CHECK` constraint plus a
unique index back the first two up.

### Reading the Gantt

Give a task both a **start** and a **due** date and it draws a bar; a due date
alone has no duration, so it shows as a small marker instead of an invented
span. Milestones are diamonds. Bar colour follows status — blue in progress,
green done, red overdue or blocked — and a red line marks today. Anything with
no date is listed under the chart rather than silently dropped.

**Everything in this phase is entered by hand.** Records carry a Manual badge
today; the `AI suggested` badge, the draft/approved review states, and the
citation lists under a card exist for a later phase where tasks and risks can be
proposed from a document. Nothing is generated yet, and no LLM call is made
anywhere in this feature.

### Where things live

The sidebar is always visible — it narrows to an icon rail on small screens
rather than hiding behind a menu button.

| Route | Sidebar entry | What it is |
|---|---|---|
| `/dashboard` | Dashboard | Workspace summary: active projects, overdue tasks, blocked tasks, upcoming milestones, and the items behind those counts |
| `/projects` | Projects | Create and open projects |
| `/documents` | All Documents | Cross-project document library — upload, reassign, delete |
| `/chat` | Ask | Grounded question answering |
| `/admin/evaluations` | Evaluations | Admin only |

Dashboard and All Documents used to be one page; they are separate so the entry
labelled "All Documents" leads to documents and nothing else.

### What deleting a project does

Deleting a project keeps knowledge and destroys only the plan, and the
confirmation names both:

- **Kept, unassigned:** documents, chat conversations, evaluation cases. Their
  `projectId` is nullable, so they survive.
- **Permanently deleted:** tasks, milestones, and risks. Their `projectId` is
  not nullable — a task with no project would be unreachable in every view.

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
  migrations/              pgvector/HNSW, full-text GIN, project layer, project management
src/
  app/
    (app)/                 projects (tabbed workspace), chat, all documents, admin
    api/                   route handlers — all Zod-validated and workspace-scoped
  lib/
    auth.ts auth-guard.ts  Auth.js config; requireWorkspace / requireProject / requireAdmin
    db.ts                  Prisma client (PrismaPg adapter) + vector serialisation
    env.ts                 lazily validated server env
    providers/             EmbeddingProvider / ChatProvider + OpenRouter impl
    storage/               StorageProvider + local-disk impl
    ingest/                validate-upload, extract, chunk, pipeline
    rag/                   hybrid retrieve/ranking, prompt, citations, answer
    pm/                    rules (pure dates/status), scoped summaries, selections
tests/                     vitest — chunking, citations, retrieval, access, refusals,
                           uploads, project-management rules and isolation
```

See [CLAUDE.md](CLAUDE.md) for invariants and conventions, and
[PLANNING.md](PLANNING.md) for the decision log and roadmap.

---

## Deployment note

The default `StorageProvider` writes to local disk, which does **not** work on
Vercel serverless (read-only filesystem). To deploy there, add an S3/R2 adapter
implementing `put`/`get`/`delete` in `src/lib/storage/` and switch the factory in
`src/lib/storage/index.ts` — no other code changes are needed.
