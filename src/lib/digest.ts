import { listBooksRecords } from "@/lib/crm/zohoBooksClient";
import { listInventoryRecords } from "@/lib/crm/zohoInventoryClient";
import { queryRecords } from "@/lib/crm/zohoClient";

const STALE_DEAL_DAYS = 14;

export interface DigestOverdueInvoice {
  id: string;
  invoiceNumber: unknown;
  customerName: unknown;
  balance: unknown;
  currencyCode: unknown;
  dueDate: unknown;
}

export interface DigestLowStockItem {
  id: string;
  name: unknown;
  sku: unknown;
  stockOnHand: unknown;
  reorderLevel: unknown;
}

export interface DigestStaleDeal {
  id: string;
  dealName: unknown;
  amount: unknown;
  stage: unknown;
  modifiedTime: unknown;
}

export interface Digest {
  generatedAt: string;
  overdueInvoices: { items: DigestOverdueInvoice[]; totalBalance: { currencyCode: string; sum: number; count: number }[] };
  lowStockItems: DigestLowStockItem[];
  staleDeals: DigestStaleDeal[];
  errors: string[];
}

/**
 * Computed deterministically from live Zoho data — no LLM involved. This is
 * a "what needs attention" dashboard, not a chat answer, so it runs the same
 * three fixed checks every time rather than letting a model decide what to
 * look at. Each section fails independently (one Zoho hiccup shouldn't blank
 * the whole digest) and gets logged into `errors` instead of throwing.
 */
export async function buildDigest(): Promise<Digest> {
  const errors: string[] = [];

  const overdueInvoices = await listBooksRecords("invoices", { status: "overdue" }).catch((err) => {
    errors.push(`Overdue invoices: ${err instanceof Error ? err.message : "failed"}`);
    return { records: [], hasMorePage: false, amountSummary: undefined };
  });

  const items = await listInventoryRecords("items", {}).catch((err) => {
    errors.push(`Inventory items: ${err instanceof Error ? err.message : "failed"}`);
    return { records: [], hasMorePage: false };
  });

  const cutoff = new Date(Date.now() - STALE_DEAL_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 19) + "+00:00";
  const staleDealsResult = await queryRecords(
    "Deals",
    `select id, Deal_Name, Amount, Stage, Modified_Time from Deals where Modified_Time < '${cutoff}' and Stage not in ('Closed Won', 'Closed Lost') order by Modified_Time asc limit 20`,
  ).catch((err) => {
    errors.push(`Stale deals: ${err instanceof Error ? err.message : "failed"}`);
    return { records: [], moreRecords: false, amountSum: undefined };
  });

  return {
    generatedAt: new Date().toISOString(),
    overdueInvoices: {
      items: overdueInvoices.records.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoice_number,
        customerName: r.customer_name,
        balance: r.balance,
        currencyCode: r.currency_code,
        dueDate: r.due_date,
      })),
      totalBalance:
        overdueInvoices.amountSummary?.map((s) => ({ currencyCode: s.currencyCode, sum: s.sum, count: s.count })) ?? [],
    },
    lowStockItems: items.records
      .filter((r) => {
        const reorder = Number(r.reorder_level);
        const onHand = Number(r.stock_on_hand);
        return reorder > 0 && !Number.isNaN(onHand) && onHand <= reorder;
      })
      .map((r) => ({ id: r.id, name: r.name, sku: r.sku, stockOnHand: r.stock_on_hand, reorderLevel: r.reorder_level })),
    staleDeals: staleDealsResult.records.map((r) => ({
      id: r.id,
      dealName: r.Deal_Name,
      amount: r.Amount,
      stage: r.Stage,
      modifiedTime: r.Modified_Time,
    })),
    errors,
  };
}
