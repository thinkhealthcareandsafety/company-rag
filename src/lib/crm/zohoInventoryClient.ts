import { getZohoEnv, getZohoBooksEnv } from "@/lib/env";
import { zohoRequestTo, ZohoApiError, type ZohoRecord } from "./zohoClient";

/**
 * Zoho Inventory shares an organization_id with Zoho Books (same Zoho One
 * account) and the same `{module: [...]}` / `{module_singular: {...}}`
 * response envelope. Scoped to items/composite items/warehouses only — the
 * actual new capability Inventory adds (stock levels, item catalog,
 * per-warehouse quantities). Sales orders, invoices, bills, and payments also
 * exist in the Inventory API, but Books is already the source of truth for
 * those in this system (see orchestrator.ts routing rules) — exposing the
 * same data through two tools would just create ambiguity for the agent.
 */

const SINGULAR: Record<string, string> = {
  items: "item",
  compositeitems: "compositeitem",
  warehouses: "warehouse",
};

const PRIMARY_ID_FIELD: Record<string, string> = {
  items: "item_id",
  compositeitems: "composite_item_id",
  warehouses: "warehouse_id",
};

export const INVENTORY_MODULES = Object.keys(SINGULAR);

// Trim to what's useful for answering stock/catalog questions — full item
// records carry pricing tiers, tax presets, image metadata, etc. not needed
// as LLM context.
const KEEP_FIELDS = new Set([
  "item_id",
  "composite_item_id",
  "warehouse_id",
  "name",
  "sku",
  "description",
  "rate",
  "purchase_rate",
  "unit",
  "item_type",
  "product_type",
  "category_name",
  "status",
  "stock_on_hand",
  "available_stock",
  "actual_available_stock",
  "committed_stock",
  "available_for_sale_stock",
  "reorder_level",
  "warehouse_name",
  "warehouse_stock_on_hand",
  "warehouse_available_stock",
  "address",
  "city",
  "state",
  "country",
  "is_primary",
  "created_time",
  "last_modified_time",
]);

function trimRecord(module: string, record: ZohoRecord): ZohoRecord {
  const idField = PRIMARY_ID_FIELD[module];
  const trimmed: ZohoRecord = { id: idField ? String(record[idField] ?? "") : "" };
  for (const [key, value] of Object.entries(record)) {
    if (KEEP_FIELDS.has(key)) trimmed[key] = value;
  }
  return trimmed;
}

// Trailing slash on the base + relative (non-leading-slash) paths — see the
// identical note in zohoBooksClient.ts for why this matters with `new URL()`.
function inventoryApiBaseUrl(): string {
  return `${getZohoEnv().ZOHO_API_BASE_URL}/inventory/v1/`;
}

export interface ListInventoryRecordsResult {
  records: ZohoRecord[];
  hasMorePage: boolean;
}

// See the identical constant/comment in zohoBooksClient.ts — Zoho caps a
// single page at 200 regardless of what's requested, so a naive single-page
// fetch would silently undercount a "how much total stock" style question.
const MAX_AUTO_PAGES = 5;

export async function listInventoryRecords(module: string, params: Record<string, string> = {}): Promise<ListInventoryRecordsResult> {
  if (!SINGULAR[module]) throw new ZohoApiError(`Unknown Zoho Inventory module: ${module}`);

  const allRecords: ZohoRecord[] = [];
  let hasMorePage = false;

  for (let page = 1; page <= MAX_AUTO_PAGES; page++) {
    const query = new URLSearchParams({
      organization_id: getZohoBooksEnv().ZOHO_BOOKS_ORGANIZATION_ID,
      per_page: "200",
      page: String(page),
      ...params,
    });

    const data = await zohoRequestTo<Record<string, unknown>>(inventoryApiBaseUrl(), `${module}?${query.toString()}`);
    const records = (data[module] as ZohoRecord[] | undefined) ?? [];
    allRecords.push(...records.map((r) => trimRecord(module, r)));

    const pageContext = data.page_context as { has_more_page?: boolean } | undefined;
    hasMorePage = pageContext?.has_more_page ?? false;
    if (!hasMorePage || records.length === 0) break;
  }

  return { records: allRecords, hasMorePage };
}

export async function getInventoryRecord(module: string, recordId: string): Promise<ZohoRecord> {
  const singular = SINGULAR[module];
  if (!singular) throw new ZohoApiError(`Unknown Zoho Inventory module: ${module}`);

  const query = new URLSearchParams({ organization_id: getZohoBooksEnv().ZOHO_BOOKS_ORGANIZATION_ID });
  const data = await zohoRequestTo<Record<string, unknown>>(inventoryApiBaseUrl(), `${module}/${recordId}?${query.toString()}`);
  const record = data[singular] as ZohoRecord | undefined;
  if (!record) throw new ZohoApiError(`No ${module} record found with id ${recordId}`);
  return trimRecord(module, record);
}
