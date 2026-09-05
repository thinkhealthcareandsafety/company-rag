# Company RAG

Unified search over internal documents and live Zoho CRM data, synthesized by an agentic
Next.js chat interface. See `plans` context: documents are chunked and embedded into
Postgres/pgvector for retrieval; CRM data is always fetched live from Zoho at answer time,
never pre-indexed. A tool-calling agent (Gemini `gemini-3.6-flash`) decides per-query which
source(s) to use and combines them into one cited answer.

## Stack

- Next.js 16 (App Router, TypeScript) — full-stack UI + API routes
- Postgres + pgvector (via Docker) — document chunk storage and vector search, `drizzle-orm`
- Gemini (`@google/genai`) — `gemini-embedding-001` (768-dim) for embeddings, `gemini-3.6-flash`
  for agentic synthesis/tool-calling. Chosen for its free tier — no billing/credit card
  required to run this project, unlike OpenAI. Free-tier requests are rate-limited (RPM/TPM/RPD);
  under heavy load, swap in a paid Gemini tier or another provider without touching the rest of
  the app — everything routes through `src/lib/gemini.ts`.
- Zoho CRM REST API — live customer record lookups
- NextAuth (credentials) — auth gate on the UI and API routes

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
     Server-based Applications, generate a grant code with (at minimum) read scopes for
     the modules you want queried, e.g. `ZohoCRM.modules.accounts.READ,ZohoCRM.modules.contacts.READ,ZohoCRM.modules.deals.READ`
     (least-privilege — this app only ever reads CRM data, never writes), then exchange the
     grant code once for a refresh token: `POST {accounts-base-url}/oauth/v2/token` with
     `grant_type=authorization_code`, `client_id`, `client_secret`, `code`.
   - `ZOHO_ACCOUNTS_BASE_URL` / `ZOHO_API_BASE_URL` — match your Zoho data center
     (`.com` US, `.eu`, `.in`, `.com.au`, `.jp`) — check which one your Self Client app
     shows in the API Console; using the wrong data center's token endpoint returns
     `invalid_client` even with correct credentials.
   - `NEXTAUTH_SECRET` — `openssl rand -base64 32`
   - `CRM_SYNC_SECRET` — any long random string, used to protect `/api/crm/sync`

4. **Apply the database schema**
   ```
   npm run db:migrate
   ```

5. **Create your first login**
   ```
   npm run user:create you@company.com "a-strong-password" "Your Name"
   ```

6. **Sync the CRM entity index** (name → Zoho record ID mapping; run once, then on a schedule)
   ```
   npm run crm:sync
   ```

7. **Run the app**
   ```
   npm run dev
   ```
   Visit `http://localhost:3000`, sign in, upload a PDF under **Documents**, then ask
   questions in **Chat**.

## How a query is answered

1. `/api/chat` streams the request into `runAgent` (`src/lib/agent/orchestrator.ts`).
2. The model is given six tools (`src/lib/agent/tools.ts`) and decides which it needs:
   `search_documents` (pgvector similarity search), `lookup_crm_entity` (name → Zoho ID,
   via the locally-synced index), `get_crm_record` / `query_crm_records` (live Zoho CRM
   REST/COQL calls), `list_books_records` / `get_books_record` (live Zoho Books calls —
   invoices, bills, expenses, payments, etc.).
3. Requested tools run **in parallel**, each with a timeout, retry, and circuit breaker
   (`src/lib/crm/zohoClient.ts`) so one slow/down source doesn't block the other.
4. The model synthesizes a single cited answer from whatever data came back, degrading
   gracefully (and saying so) if a tool failed.

## Keeping CRM data live, not stale

`crm_entity_index` stores **only** `id` + display name per record, refreshed by
`npm run crm:sync` (wire this to a cron job hitting `POST /api/crm/sync` with header
`x-crm-sync-secret`). Actual field values are never cached — every `get_crm_record` /
`query_crm_records` call hits Zoho live. This is the deliberate fix for the most common
RAG+CRM failure mode: an LLM confidently answering from a stale cached snapshot.

## Deploying to Render

This repo includes a `render.yaml` Blueprint that provisions the web service and a managed
Postgres (with pgvector) together.

1. Push this repo to GitHub.
2. In the Render dashboard: **New +** → **Blueprint** → connect the repo. Render reads
   `render.yaml` and provisions both the web service and the `company-rag-db` database.
3. Render will prompt for the env vars marked `sync: false` in `render.yaml` — fill in the
   same values as your local `.env` (`GEMINI_API_KEY`, `ZOHO_*`, `NEXTAUTH_SECRET`,
   `NEXTAUTH_URL` — set this to your Render service's `https://*.onrender.com` URL,
   `CRM_SYNC_SECRET`). `DATABASE_URL` is wired automatically from the provisioned database.
4. Deploy. The start command runs `db:migrate:prod` (idempotent — safe on every restart)
   before starting the server, so the schema is applied automatically.
5. Once live, run `npm run user:create:prod you@company.com "a-strong-password"` from
   Render's Shell tab (paid plans) — or run `user:create` locally against the same
   `DATABASE_URL` — to create your first login. Then run `crm:sync` the same way to
   populate the CRM entity index.

**Free-tier limitations to know before relying on this for real use:**
- Render's **free Postgres expires 30 days after creation** (14-day grace period, then the
  database and all its data are permanently deleted). Fine for a demo; upgrade to a paid
  Postgres plan before this becomes anyone's real working tool.
- Free web services **spin down after 15 minutes of no traffic** and take ~1 minute to wake
  back up on the next request — the first request after idle time will feel slow.

## Not built yet (documented, not implemented)

This is a working MVP foundation, not a fully hardened enterprise deployment. Before
production rollout at scale, add:

- **Multi-tenant row-level ACLs** on documents/chat — v1 is single-tenant (any
  authenticated user sees all documents).
- **SSO/SAML** — v1 uses email+password credentials only.
- **Secrets manager** (Vault/AWS Secrets Manager/etc.) instead of `.env` in production.
- **Shared rate-limit store** (Redis/Upstash) — the current limiter
  (`src/lib/rateLimit.ts`) is in-memory and per-instance; it won't coordinate across
  multiple app instances behind a load balancer.
- **Background job queue** (e.g. BullMQ) for ingestion instead of a fire-and-forget
  promise (`src/app/api/documents/route.ts`) — fine on a single long-running Node
  process, but a serverless/edge deployment would kill ingestion mid-flight after the
  HTTP response closes.
- **OCR** for scanned/image-only PDFs (current extraction requires embedded text).
- **Observability**: structured request tracing across the vector search + CRM tool
  calls, latency dashboards, alerting on circuit-breaker trips.
