import { getZohoEnv, getZohoBooksEnv } from "@/lib/env";
import { zohoRequestTo, ZohoApiError, type ZohoRecord } from "./zohoClient";

/**
 * Zoho Books is a separate product from CRM but the same Zoho account —
 * reuses the OAuth token, retry, and circuit-breaker logic from
 * zohoClient.ts (zohoRequestTo), just pointed at a different base path.
 * Unlike CRM's uniform `{ data: [...] }` envelope, Books responses key the
 * array by the plural module name itself (e.g. `{ invoices: [...] }` for
 * /invoices, `{ invoice: {...} }` singular for a single record).
 */

const SINGULAR: Record<string, string> = {
  invoices: "invoice",
  estimates: "estimate",
  bills: "bill",
  expenses: "expense",
  salesorders: "salesorder",
  purchaseorders: "purchaseorder",
  customerpayments: "payment",
  vendorpayments: "vendorpayment",
  creditnotes: "creditnote",
  debitnotes: "debitnote",
  contacts: "contact",
  projects: "project",
};

// Each module's actual primary-key field name — not always `${singular}_id`
// (both customer and vendor payments use "payment_id" in Zoho's API).
const PRIMARY_ID_FIELD: Record<string, string> = {
  invoices: "invoice_id",
  estimates: "estimate_id",
  bills: "bill_id",
  expenses: "expense_id",
  salesorders: "salesorder_id",
  purchaseorders: "purchaseorder_id",
  customerpayments: "payment_id",
  vendorpayments: "payment_id",
  creditnotes: "creditnote_id",
  debitnotes: "debitnote_id",
  contacts: "contact_id",
  projects: "project_id",
};

export const BOOKS_MODULES = Object.keys(SINGULAR);

// Zoho Books records carry 50+ fields each (custom fields, full billing/
// shipping addresses, template metadata, tags, ...) — fine for rendering an
// invoice PDF, wasteful as LLM context for "which invoices are unpaid".
// Trim every record down to the fields actually useful for answering
// questions, applied uniformly since the useful fields overlap heavily
// across invoices/bills/estimates/payments/etc.
const KEEP_FIELDS = new Set([
  "invoice_id",
  "bill_id",
  "estimate_id",
  "salesorder_id",
  "purchaseorder_id",
  "payment_id",
  "creditnote_id",
  "debitnote_id",
  "contact_id",
  "customer_id",
  "vendor_id",
  "project_id",
  "invoice_number",
  "bill_number",
  "estimate_number",
  "salesorder_number",
  "purchaseorder_number",
  "payment_number",
  "creditnote_number",
  "debitnote_number",
  "reference_number",
  "customer_name",
  "vendor_name",
  "contact_name",
  "company_name",
  "project_name",
  "status",
  "current_sub_status",
  "expense_id",
  "date",
  "due_date",
  "expense_date",
  "due_days",
  "total",
  "balance",
  "sub_total",
  "amount",
  "bcy_total",
  "currency_code",
  "currency_symbol",
  "email",
  "phone",
  "created_time",
  "last_modified_time",
]);

// Books' primary key field is per-module (invoice_id, bill_id, ...), not a
// uniform "id" like CRM — ZohoRecord's `id` requirement is satisfied by
// aliasing the module's actual primary-key field.
function trimRecord(module: string, record: ZohoRecord): ZohoRecord {
  const idField = PRIMARY_ID_FIELD[module];
  const trimmed: ZohoRecord = { id: idField ? String(record[idField] ?? "") : "" };
  for (const [key, value] of Object.entries(record)) {
    if (KEEP_FIELDS.has(key)) trimmed[key] = value;
  }
  return trimmed;
}

// Trailing slash matters: new URL(path, base) treats a leading "/" on `path`
// as absolute-from-origin, which silently drops the "/books/v3" base path
// segment. A trailing slash on the base plus a *relative* (non-leading-slash)
// path is what actually appends correctly.
function booksApiBaseUrl(): string {
  return `${getZohoEnv().ZOHO_API_BASE_URL}/books/v3/`;
}

export interface ListBooksRecordsResult {
  records: ZohoRecord[];
  hasMorePage: boolean;
  // Exact server-computed sums per currency, when records carry a numeric
  // total/amount field — an LLM manually adding up dozens/hundreds of line
  // items is a real source of wrong totals, so this is computed here instead
  // of being left as arithmetic for the model to (maybe) get right.
  amountSummary?: { currencyCode: string; sum: number; count: number }[];
}

function summarizeAmounts(records: ZohoRecord[]): ListBooksRecordsResult["amountSummary"] {
  const totals = new Map<string, { sum: number; count: number }>();

  for (const record of records) {
    const raw = record.total ?? record.amount ?? record.bcy_total;
    const amount = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isNaN(amount)) continue;

    const currency = typeof record.currency_code === "string" ? record.currency_code : "unknown";
    const existing = totals.get(currency) ?? { sum: 0, count: 0 };
    existing.sum += amount;
    existing.count += 1;
    totals.set(currency, existing);
  }

  if (totals.size === 0) return undefined;
  return [...totals.entries()].map(([currencyCode, { sum, count }]) => ({
    currencyCode,
    sum: Math.round(sum * 100) / 100,
    count,
  }));
}

// Zoho hard-caps a single page at 200 records regardless of what's
// requested, so a naive single-page fetch silently undercounts anything
// asking for a total/sum over a busier period. Auto-paginate up to this many
// pages (1,000 records) before giving up and reporting hasMorePage — enough
// for a realistic month of transactions at this business's scale, while
// keeping worst-case latency bounded (each page is a sequential round trip,
// and the agent's tool-call timeout has to cover the whole fetch).
const MAX_AUTO_PAGES = 5;

/**
 * Lists/filters records in one Books module. `params` are passed straight
 * through as query params — Zoho Books uses simple filters per module
 * (e.g. status=unpaid, date_start=, date_end=, customer_id=) rather than a
 * query language like CRM's COQL, so the agent supplies whichever filter
 * keys are relevant to the question. Auto-paginates internally (see
 * MAX_AUTO_PAGES) so the agent gets a complete result set for anything
 * within that bound, rather than having to reason about pages itself.
 */
export async function listBooksRecords(module: string, params: Record<string, string> = {}): Promise<ListBooksRecordsResult> {
  if (!SINGULAR[module]) throw new ZohoApiError(`Unknown Zoho Books module: ${module}`);

  const allRecords: ZohoRecord[] = [];
  let hasMorePage = false;

  for (let page = 1; page <= MAX_AUTO_PAGES; page++) {
    const query = new URLSearchParams({
      organization_id: getZohoBooksEnv().ZOHO_BOOKS_ORGANIZATION_ID,
      per_page: "200",
      page: String(page),
      ...params,
    });

    const data = await zohoRequestTo<Record<string, unknown>>(booksApiBaseUrl(), `${module}?${query.toString()}`);
    const records = (data[module] as ZohoRecord[] | undefined) ?? [];
    allRecords.push(...records.map((r) => trimRecord(module, r)));

    const pageContext = data.page_context as { has_more_page?: boolean } | undefined;
    hasMorePage = pageContext?.has_more_page ?? false;
    if (!hasMorePage || records.length === 0) break;
  }

  return { records: allRecords, hasMorePage, amountSummary: summarizeAmounts(allRecords) };
}

export async function getBooksRecord(module: string, recordId: string): Promise<ZohoRecord> {
  const singular = SINGULAR[module];
  if (!singular) throw new ZohoApiError(`Unknown Zoho Books module: ${module}`);

  const query = new URLSearchParams({ organization_id: getZohoBooksEnv().ZOHO_BOOKS_ORGANIZATION_ID });
  const data = await zohoRequestTo<Record<string, unknown>>(booksApiBaseUrl(), `${module}/${recordId}?${query.toString()}`);
  const record = data[singular] as ZohoRecord | undefined;
  if (!record) throw new ZohoApiError(`No ${module} record found with id ${recordId}`);
  return trimRecord(module, record);
}
