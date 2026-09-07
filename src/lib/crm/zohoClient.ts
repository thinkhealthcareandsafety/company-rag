import { getZohoEnv } from "@/lib/env";

const REQUEST_TIMEOUT_MS = 5000;
const MAX_RETRIES = 2;
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RESET_MS = 30_000;

class ZohoApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "ZohoApiError";
  }
}

// --- OAuth token cache -------------------------------------------------
// Server-based/self-client grant: we hold a long-lived refresh token (env)
// and exchange it for a short-lived access token, cached in memory until it
// is about to expire. Avoids a token round-trip on every single CRM call.
let cachedAccessToken: { token: string; expiresAt: number } | undefined;

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const env = getZohoEnv();
  const url = new URL("/oauth/v2/token", env.ZOHO_ACCOUNTS_BASE_URL);
  url.searchParams.set("refresh_token", env.ZOHO_REFRESH_TOKEN);
  url.searchParams.set("client_id", env.ZOHO_CLIENT_ID);
  url.searchParams.set("client_secret", env.ZOHO_CLIENT_SECRET);
  url.searchParams.set("grant_type", "refresh_token");

  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    throw new ZohoApiError(`Zoho OAuth token refresh failed (${res.status})`, res.status);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };

  cachedAccessToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedAccessToken.token;
}

// --- Circuit breaker -----------------------------------------------------
// Prevents hammering a degraded/down Zoho with retries from every concurrent
// chat request; after enough consecutive failures we short-circuit calls for
// a cool-down window and fail fast so the agent can degrade gracefully.
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function assertCircuitClosed() {
  if (Date.now() < circuitOpenUntil) {
    throw new ZohoApiError("Zoho CRM is temporarily unavailable (circuit open) — try again shortly");
  }
}

function recordSuccess() {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

function recordFailure() {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_RESET_MS;
  }
}

// --- Core request helper --------------------------------------------------
// Shared by both the CRM client (below) and the Books client
// (zohoBooksClient.ts) — same Zoho account/OAuth token, same resilience
// characteristics, just a different base URL and resource paths.

export async function zohoRequestTo<T>(baseUrl: string, path: string, init?: RequestInit, attempt = 0): Promise<T> {
  assertCircuitClosed();

  const accessToken = await getAccessToken();
  const url = new URL(path, baseUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    if (res.status >= 500 && attempt < MAX_RETRIES) {
      recordFailure();
      await backoff(attempt);
      return zohoRequestTo<T>(baseUrl, path, init, attempt + 1);
    }

    if (!res.ok) {
      recordFailure();
      const body = await res.text().catch(() => "");
      throw new ZohoApiError(`Zoho request failed (${res.status}): ${body.slice(0, 300)}`, res.status);
    }

    recordSuccess();
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ZohoApiError) throw err;
    if (attempt < MAX_RETRIES) {
      recordFailure();
      await backoff(attempt);
      return zohoRequestTo<T>(baseUrl, path, init, attempt + 1);
    }
    recordFailure();
    const message = err instanceof Error ? err.message : "network error";
    throw new ZohoApiError(`Zoho request failed after retries: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function zohoRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return zohoRequestTo<T>(getZohoEnv().ZOHO_API_BASE_URL, path, init);
}

function backoff(attempt: number): Promise<void> {
  const delayMs = 250 * 2 ** attempt;
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

// --- Public API -------------------------------------------------------

export interface ZohoRecord {
  id: string;
  [field: string]: unknown;
}

export async function getRecord(module: string, recordId: string, fields?: string[]): Promise<ZohoRecord> {
  const query = fields?.length ? `?fields=${encodeURIComponent(fields.join(","))}` : "";
  const data = await zohoRequest<{ data: ZohoRecord[] }>(`/crm/v6/${module}/${recordId}${query}`);
  const record = data.data[0];
  if (!record) throw new ZohoApiError(`No ${module} record found with id ${recordId}`);
  return record;
}

export interface QueryRecordsResult {
  records: ZohoRecord[];
  // Zoho COQL caps a single query at 200 rows regardless of LIMIT, and has no
  // server-side SUM/aggregate functions — so unlike Books' listBooksRecords,
  // we can't safely auto-paginate here (the model may have deliberately
  // written "limit 10" for a top-N query, not an exhaustive one). Instead we
  // surface moreRecords so the model can decide whether to re-query with a
  // higher OFFSET for a complete total, and compute an exact sum over
  // whatever numeric "Amount" field is present so it never has to add up
  // rows by hand for what it did retrieve.
  moreRecords: boolean;
  amountSum?: number;
}

export async function queryRecords(module: string, coql: string): Promise<QueryRecordsResult> {
  const data = await zohoRequest<{ data: ZohoRecord[]; info?: { more_records?: boolean } }>(`/crm/v6/coql`, {
    method: "POST",
    body: JSON.stringify({ select_query: coql }),
  });
  const records = data.data ?? [];

  const amounts = records
    .map((r) => r.Amount)
    .filter((v): v is number | string => typeof v === "number" || typeof v === "string")
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  const amountSum = amounts.length > 0 ? Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100 : undefined;

  return { records, moreRecords: data.info?.more_records ?? false, amountSum };
}

export interface ListRecordsPage {
  records: ZohoRecord[];
  nextPageToken?: string;
  moreRecords: boolean;
}

/**
 * Zoho's v6 Records API only allows plain `page` numbers through the first
 * 2000 records of a module (DISCRETE_PAGINATION_LIMIT_EXCEEDED beyond that);
 * paging further requires the cursor-based `page_token` it returns in
 * `info.next_page_token`. Cursor-only throughout keeps this correct for
 * modules with any number of records, not just small ones.
 */
export async function listRecordsForSync(module: string, pageToken: string | undefined, perPage: number): Promise<ListRecordsPage> {
  const params = new URLSearchParams({ fields: `id,${nameFieldFor(module)}`, per_page: String(perPage) });
  if (pageToken) params.set("page_token", pageToken);

  const data = await zohoRequest<{ data: ZohoRecord[]; info?: { more_records?: boolean; next_page_token?: string } }>(
    `/crm/v6/${module}?${params.toString()}`,
  );
  return {
    records: data.data ?? [],
    nextPageToken: data.info?.next_page_token,
    moreRecords: data.info?.more_records ?? false,
  };
}

export function nameFieldFor(module: string): string {
  if (module === "Contacts") return "Full_Name";
  if (module === "Deals") return "Deal_Name";
  return "Account_Name"; // Accounts (default)
}

export { ZohoApiError };
