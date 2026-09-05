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
}

/**
 * Lists/filters records in one Books module. `params` are passed straight
 * through as query params — Zoho Books uses simple filters per module
 * (e.g. status=unpaid, date_start=, date_end=, customer_id=) rather than a
 * query language like CRM's COQL, so the agent supplies whichever filter
 * keys are relevant to the question.
 */
export async function listBooksRecords(module: string, params: Record<string, string> = {}): Promise<ListBooksRecordsResult> {
  if (!SINGULAR[module]) throw new ZohoApiError(`Unknown Zoho Books module: ${module}`);

  const query = new URLSearchParams({
    organization_id: getZohoBooksEnv().ZOHO_BOOKS_ORGANIZATION_ID,
    ...params,
  });

  const data = await zohoRequestTo<Record<string, unknown>>(booksApiBaseUrl(), `${module}?${query.toString()}`);
  const records = ((data[module] as ZohoRecord[] | undefined) ?? []).map((r) => trimRecord(module, r));
  const pageContext = data.page_context as { has_more_page?: boolean } | undefined;

  return { records, hasMorePage: pageContext?.has_more_page ?? false };
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
