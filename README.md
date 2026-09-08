# think health — AI assistant

An agentic RAG chat assistant for think health: it answers questions by deciding, per
question, which of four live sources to check — internal policy documents, Zoho CRM, Zoho
Books, or Zoho Inventory — then combines whatever it finds into one cited answer. It also
proactively surfaces what needs attention (overdue invoices, low stock, stale deals) without
being asked, via the **Digest** page.

Documents are chunked and embedded into Postgres/pgvector for retrieval. CRM/Books/Inventory
data is **never** pre-indexed or cached — every lookup is a live, read-only API call to Zoho at
answer time, so the assistant can never give a stale answer about live business data.

## Stack

- Next.js 16 (App Router, TypeScript) — full-stack UI + API routes
- Postgres + pgvector (via Docker locally, Render-managed in production) — document chunk
  storage and vector search (HNSW index), plus all other app data, via `drizzle-orm`
- Gemini (`@google/genai`) — `gemini-embedding-001` (768-dim) for embeddings,
  `gemini-3.5-flash-lite` for agentic tool-calling/synthesis. Chosen for its free tier — no
  billing/credit card required to run this project. Everything routes through
  `src/lib/gemini.ts`, so swapping models or providers later doesn't touch the rest of the app.
- Zoho CRM, Books, and Inventory REST/COQL APIs — live, **read-only** OAuth scopes only; this
  app can see everything, change nothing
- NextAuth (credentials + bcrypt) — per-user accounts, not one shared login
- Upstash Redis (optional) — shared rate limiting across instances; falls back to an in-memory
  limiter automatically if not configured
- Sentry (optional) — external error tracking; also has its own in-app Errors page that needs
  no external account to use

## Features

- **Agentic tool-calling loop** (hand-rolled, no LangChain — `src/lib/agent/orchestrator.ts`):
  the model is given 8 tools and decides per-question which to call, running independent ones
  in parallel, up to 4 iterations before forcing a final answer.
- **Per-user accounts** — private conversation history, managed via the in-app **Team** page
  (no separate admin CLI needed once the first account exists).
- **Streaming answers** (Server-Sent Events) with **Stop** and **Regenerate** controls.
- **Click-to-preview source citations** on document-backed answers.
- **Prompt shortcuts** — save a full question under a short `/trigger` word.
- **Digest** (`/digest`) — a proactive, code-computed dashboard (no AI in the numbers) showing
  overdue invoices, low-stock items, and CRM deals gone quiet, with one AI-generated
  plain-English summary sentence on top and per-item AI-drafted follow-up messages
  (draft-and-copy only — nothing is ever sent automatically).
- **In-app Errors page** — every failure is logged to Postgres and visible to any signed-in
  user, independent of whether Sentry is configured.
- **Reliability fixes worth knowing about**: the model is told the real current date on every
  request (it has no other way to know "today"), and Books/CRM totals are computed exactly in
  code rather than left to the model's arithmetic, with an explicit flag if a result set is too
  large to be complete.

## Setup

1. **Install dependencies**
   ```
   npm install
   ```

2. **Start Postgres (pgvector)**
   ```
   docker compose up -d
   ```

3. **Configure environment**
   ```
   cp .env.example .env
   ```
   Fill in:
   - `GEMINI_API_KEY` — free, no billing required: create one at
     [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   - `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_REFRESH_TOKEN` — create a
     **Self Client** at [api-console.zoho.com](https://api-console.zoho.com) under
     Server-based Applications, generate a grant code with **read-only** scopes across
     whichever of CRM, Books, and Inventory you want queried (see `.env.example` for the
     one-time OAuth exchange details), then exchange the grant code once for a refresh
     token: `POST {accounts-base-url}/oauth/v2/token` with `grant_type=authorization_code`,
     `client_id`, `client_secret`, `code`.
   - `ZOHO_ACCOUNTS_BASE_URL` / `ZOHO_API_BASE_URL` — match your Zoho data center
     (`.com` US, `.eu`, `.in`, `.com.au`, `.jp`) — using the wrong one returns `invalid_client`
     even with correct credentials.
   - `ZOHO_BOOKS_ORGANIZATION_ID` — shared by Books and Inventory (same Zoho One account).
   - `NEXTAUTH_SECRET` — `openssl rand -base64 32`
   - `CRM_SYNC_SECRET` — any long random string, used to protect `/api/crm/sync`
   - Optional: `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (shared rate limiting),
     `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` (external error tracking) — the app runs fine
     without either.

4. **Apply the database schema**
   ```
   npm run db:migrate
   ```

5. **Create your first login**
   ```
   npm run user:create you@company.com "a-strong-password" "Your Name"
   ```
   Every teammate after that can be added from the in-app **Team** page — no CLI needed.

6. **Sync the CRM entity index** (name → Zoho record ID mapping; run once, then on a schedule)
   ```
   npm run crm:sync
   ```

7. **Run the app**
   ```
   npm run dev
   ```
   Visit `http://localhost:3000`, sign in, upload a PDF under **Documents**, then ask
   questions in **Chat** — or check **Digest** for what needs attention right now.

## How a query is answered

1. `/api/chat` streams the request into `runAgent` (`src/lib/agent/orchestrator.ts`).
2. The model is given eight tools (`src/lib/agent/tools.ts`) and decides which it needs:
   `search_documents` (pgvector similarity search), `lookup_crm_entity` (name → Zoho ID via
   the locally-synced index), `get_crm_record` / `query_crm_records` (live Zoho CRM
   REST/COQL), `list_books_records` / `get_books_record` (live Zoho Books — invoices, bills,
   expenses, payments, etc.), `list_inventory_records` / `get_inventory_record` (live Zoho
   Inventory — items, stock levels, warehouses).
3. Requested tools run **in parallel**, each with a timeout, retry, and circuit breaker
   (`src/lib/crm/zohoClient.ts`) so one slow/down source doesn't block the others.
4. The model synthesizes a single cited answer from whatever data came back, degrading
   gracefully (and saying so) if a tool failed or a result set was too large to be complete.

## Keeping data live, not stale

`crm_entity_index` stores **only** `id` + display name per record, refreshed by
`npm run crm:sync` (wire this to a cron job hitting `POST /api/crm/sync` with header
`x-crm-sync-secret`). Actual field values are never cached for CRM, Books, or Inventory —
every real lookup hits Zoho live. This is the deliberate fix for the most common RAG+live-data
failure mode: an LLM confidently answering from a stale cached snapshot.

## The Digest page

`/digest` (`src/lib/digest.ts`) runs three fixed checks against live Zoho data, entirely in
code — no model involved in the numbers:

- Overdue invoices (Books), with an exact server-computed total per currency
- Low-stock items (Inventory) — items at or below their reorder level
- CRM deals with no activity in 14+ days, excluding closed stages

Results are cached for 2 minutes (the Inventory check alone pages through the full item
catalog, since Zoho has no server-side "low stock only" filter) — the **Refresh** button
always forces a fresh check. One AI-generated sentence summarizes the numbers on top, and each
overdue invoice / stale deal has a **Draft message** button that generates a copy-ready
follow-up — deliberately draft-only, with no way to send it from the app.

## Deploying to Render

This repo includes a `render.yaml` Blueprint that provisions the web service and a managed
Postgres (with pgvector) together.

1. Push this repo to GitHub.
2. In the Render dashboard: **New +** → **Blueprint** → connect the repo. Render reads
   `render.yaml` and provisions both the web service and the `company-rag-db` database.
3. Render will prompt for the env vars marked `sync: false` in `render.yaml` — fill in the
   same values as your local `.env`. `DATABASE_URL` is wired automatically from the
   provisioned database. Redis and Sentry vars are optional — leave them blank and the app
   falls back gracefully.
4. Deploy. The start command runs `db:migrate:prod` (idempotent — safe on every restart)
   before starting the server, so the schema is applied automatically.
5. Once live, use the in-app **Team** page to create every login after the first — bootstrap
   the very first one via `/api/setup/create-user` (a one-time HTTPS endpoint gated by
   `CRM_SYNC_SECRET`, protected by refusing to run once any user already exists), since
   Render's free plan has no Shell access for running `user:create:prod` directly.

**Free-tier limitations to know before relying on this for real use:**
- Render's **free Postgres expires 30 days after creation** (14-day grace period, then the
  database and all its data are permanently deleted). Fine for a demo; upgrade to a paid
  Postgres plan before this becomes anyone's real working tool.
- Free web services **spin down after 15 minutes of no traffic** and take ~30-60 seconds to
  wake back up on the next request — the first request after idle time will feel slow.

## Not built yet (documented, not implemented)

This is a working product foundation, not a fully hardened enterprise deployment. Real,
deliberately-deferred gaps:

- **Only PDFs are ingested** — no Word/Excel/CSV/scanned-image support yet.
- **Fully reactive, not push-based** — Digest has to be opened to be seen; there's no
  scheduled email/WhatsApp delivery yet (would need an email/messaging service signup).
- **Read-only by design** — no write actions against Zoho anywhere, including the drafted
  follow-up messages (copy-only, sent manually by a human). This was a deliberate security
  tradeoff, not an oversight — revisit only with a real, scoped need and a human-approval step.
- **Multi-tenant row-level ACLs** on documents/chat — any authenticated user sees all
  documents; there's no per-team or per-role data isolation.
- **SSO/SAML** — credentials (email + password) only.
- **Secrets manager** (Vault/AWS Secrets Manager/etc.) instead of `.env` in production.
- **Background job queue** (e.g. BullMQ) for document ingestion instead of a fire-and-forget
  promise (`src/app/api/documents/route.ts`) — fine on a single long-running Node process, but
  a serverless/edge deployment would kill ingestion mid-flight after the HTTP response closes.
- **OCR** for scanned/image-only PDFs (current extraction requires embedded text).
- **Observability**: structured request tracing across the vector search + Zoho tool calls,
  latency dashboards, alerting on circuit-breaker trips (Sentry covers unhandled errors, not
  this).
