# ScopePilot — AI Requirements-to-Delivery Copilot

Turn client briefs, meeting notes, SOPs, and delivery records into cited,
reviewable **requirements** and cited, reviewable **plans**. Agreed requirements
are traced to the tasks that deliver them, so scope with no delivery behind it is
a number on a dashboard rather than something someone has to remember. Approved
work is tracked with tasks, milestones, dependencies, risks, timelines, and
weekly status reports.

When the available evidence does not cover something, ScopePilot says so instead
of inventing an answer.

> This is a retrieval-augmented generation (RAG) workflow, not an autonomous
> agent. It answers questions; it does not take actions on external systems.

## Features

- Project workspaces with separate document libraries and project-scoped chat
- **Cited requirements extraction** from selected project documents — MoSCoW
  priority, acceptance criteria, assumptions, and honest confidence, every one
  reviewed by a person before it counts as agreed scope
- **Requirement traceability** linking agreed scope to the tasks delivering it,
  with uncovered and unvalidated requirements surfaced as counts
- **Cited plan generation** from up to 20 selected project documents, with a
  dedicated Review workflow before any suggestion becomes operational work
- **Project management inside each workspace** — a drag-and-drop Kanban board,
  list view, task dependencies, milestones, and risks
- **Gantt timeline** showing tasks and milestones against a date axis, with a
  today marker and overdue highlighting
- **Combined project Q&A** grounded in both document evidence and frozen
  snapshots of approved tasks, milestones, risks, dependencies, and exact counts
- **Saved weekly reports** with deterministic completed/blocker/overdue/upcoming
  sections, server-derived health, a cited executive narrative, and immutable history
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

This runs `prisma migrate deploy`, then `prisma generate`, then a pgvector index
check. Prisma 7 no longer generates the client automatically after migrating,
which is why the first two are chained.

The third step exists because Prisma cannot see raw-SQL indexes on
`Unsupported()` columns and tries to drop the pgvector HNSW index on every
migration. Losing it does not break correctness — it silently turns vector
search into a sequential scan — so the check recreates the index if missing and
fails loudly if it is built with the wrong operator class. Run it any time with:

```bash
npm run db:ensure-index
```

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

## Testing the core copilot loop manually

With the app running and a real `OPENROUTER_API_KEY` set:

1. **Sign in** at `/login` (register, or use the seeded demo account).

2. **Create a project** at `/projects`. Creating it opens the project workspace.

3. **Upload requirements and meeting notes inside the project.** For example,
   make the requirements state that UAT needs an approved test environment and
   make the meeting notes record that environment provisioning is still open.

4. **Watch the status** go `uploaded → processing → ready`. The project polls
   automatically. A document is only marked ready once its chunks and embeddings
   are committed — if anything fails you get a `failed` badge with the reason.

5. Open **Review** and generate a plan. Check the scope, deliverables,
   acceptance criteria, proposed milestones, tasks, risks, dependencies, and
   their document/page/section excerpts. Edit one proposal, reject another, and
   approve the rest.

6. Open **Tasks**, **Timeline**, and **Risks**. Only approved suggestions should
   appear; rejected and still-draft suggestions remain visible only in Review
   history.

7. Click **AI Chat** and ask:
   > What is required for UAT, and what currently blocks it?

   A mixed answer separates **Document requirements** from **Current project
   state** and cites both document chunks and saved live-record snapshots.

8. Ask an unsupported question. Expect a clear refusal, not a fabricated
   answer. Click document citations to compare excerpts with the source and use
   the thumbs buttons to leave feedback.

9. Open **Reports** and generate the weekly report. Verify its UTC period,
   health, exact deterministic sections, narrative citations, history entry,
   model/latency metadata, and **Copy as Markdown** action.

10. **Record an evaluation** at `/admin/evaluations`: select its project scope,
   enter a question and what a correct answer should mention, run it, then mark
   it pass or fail. Project, latency, model name, and retrieved chunk IDs are
   stored with each case.

## Testing the requirement register

This is the discovery half of the product: what the client asked for, before and
separately from the work created to deliver it. Steps 1 and 6 need no API key.

1. **Record one by hand.** Open a project, go to **Requirements**, and create
   one. It appears as `REQ-001`, badged **Manual** and **draft** — saving a
   requirement is not the same as agreeing it, so nothing starts approved.

2. **Extract drafts from a document.** Upload a brief or requirements document,
   wait for it to reach *ready*, select it, and choose **Extract draft
   requirements**. Each proposal must carry at least one source link that opens
   the document it came from. Anything the model could not cite is discarded
   before it reaches the database, so an empty result means no evidence — not a
   silent failure.

3. **Check the grounding claim, not just the output.** Find a vague line in the
   source ("the system must be secure", "data is kept for a while"). The matching
   requirement should stay at that level of detail with **confidence: low** — it
   must *not* have invented multi-factor authentication, an encryption standard,
   or a retention period. That invention is the failure mode the register exists
   to prevent, and it is worth checking on every prompt change.

4. **Review them.** Use the status dropdown on each row. Approve some, reject
   others, and move one to *Needs clarification* — it stays visible in the
   register under its own filter, because an unresolved requirement is something
   you act on rather than something to hide in run history.

5. **Find the gap.** Approve five requirements, then link three of them to tasks
   with **Link task**. The **Gaps** filter and the **Uncovered requirements**
   stat on the project Overview must both read 2. They come from the same
   builder in `src/lib/pm/rules.ts`, so a disagreement is a bug.

6. **Ask about coverage.** In project chat, ask *"which approved requirements
   have no delivery task?"* The answer should cite the project snapshot plus the
   individual requirements, and its numbers should match the Gaps filter. Draft
   requirements must not appear — only approved ones are agreed scope.

7. **Delete the project** and confirm the warning names the requirement count
   alongside tasks, milestones, and risks. Requirements cascade; documents
   survive as unassigned.

## Testing manual project management

Creating and editing manual records does not call a model and still works on a
fresh database. AI suggestions enter these views only after Review approval.

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
   documents become unassigned and how many requirements, tasks, milestones, and
   risks are permanently deleted. Confirm, then check that the documents still
   exist on `/documents` as unassigned.

---

## Project management

Each project is a knowledge container, a record of what was agreed, and a place
to track the work delivering it. Open a project and use its sidebar sections —
Requirements comes before Tasks because discovery precedes delivery:

Navigation lives in the left sidebar: global links at the top, and the sections
of whichever project you are in below it.

| Section | What it does |
|---|---|
| **Overview** | Approved and uncovered requirements, open/overdue/blocked/risk counts, and overdue tasks, upcoming milestones, and document readiness at a glance |
| **Requirements** | The requirement register — extract cited drafts from documents, validate or reject them, link agreed scope to delivery tasks, and filter for coverage **Gaps** |
| **Tasks** | Board/List views for Backlog, To do, In progress, Blocked, Done. **Drag a card between columns** to change its status; click a card or list row for the detail panel |
| **Timeline** | A **Gantt chart** of tasks and milestones, then what is overdue, due in the next 7 days, and later — plus milestone management |
| **Documents** | The project's document library (unchanged) |
| **Risks** | Impact, likelihood, mitigation, and status for each recorded risk |
| **Review** | Generate cited draft plans, edit proposals, approve/reject in batches, and inspect immutable run history |
| **Reports** | Generate and revisit saved seven-day status reports with deterministic sections and cited narratives |

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

Manual records are immediately official and carry a **Manual** badge. Generated
records start as **AI suggested / Draft** and are excluded from boards,
timelines, dashboards, summaries, reports, dependency candidates, and chat
grounding until a person approves them in Review. Rejected proposals stay in
run history for audit. Approved AI records retain their citations and reviewer
timestamp.

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
- **Permanently deleted:** requirements, tasks, milestones, and risks. Their
  `projectId` is not nullable — a task with no project would be unreachable in
  every view.

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

1. **Evidence gate (before the model is called).** Vector and PostgreSQL
   full-text candidate rankings are fused. Global chat refuses unless a
   qualifying document chunk exists. Project chat can also proceed from an
   exact project snapshot or relevant approved live record; it refuses only
   when neither evidence family exists.

2. **Citation whitelist (after the model replies).** Document chunks are
   labelled `S1…Sn`; live source kinds use disjoint opaque labels. Real database
   IDs are never sent to the model. Returned identifiers are resolved through a
   server-side map, unknown labels are dropped, and an answer left with no valid
   citation becomes a refusal. Mixed answers must cite the required evidence
   families and use separate requirements/current-state headings.

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
npm run db:migrate   # migrate deploy + generate + pgvector index check
npm run db:ensure-index  # verify/repair the pgvector index on its own
npm run db:seed      # seed the demo account
npm run db:studio    # Prisma Studio
```

---

## Project structure

```
prisma/
  schema.prisma            data model (Unsupported("vector(1536)") for embeddings)
  migrations/              pgvector/HNSW, full-text GIN, project layer, project
                           management, requirement register
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
    grounding/             shared document-citation verification
    generation/            shared context selection; plan and requirements prompts,
                           validation, persistence, review
    reports/               deterministic weekly snapshots, health, narrative persistence
    pm/                    rules (pure dates/status), scoped summaries, selections
tests/                     vitest — chunking, citations, retrieval, access, refusals,
                           uploads, project-management rules and isolation,
                           requirement rules, schemas, extraction, validation
```

See [CLAUDE.md](CLAUDE.md) for invariants and conventions, and
[PLANNING.md](PLANNING.md) for the decision log and roadmap.

---

## Deployment note

The default `StorageProvider` writes to local disk, which does **not** work on
Vercel serverless (read-only filesystem). To deploy there, add an S3/R2 adapter
implementing `put`/`get`/`delete` in `src/lib/storage/` and switch the factory in
`src/lib/storage/index.ts` — no other code changes are needed.
