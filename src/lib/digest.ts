import { getGemini, CHAT_MODEL } from "@/lib/gemini";
import { listBooksRecords } from "@/lib/crm/zohoBooksClient";
import { listInventoryRecords } from "@/lib/crm/zohoInventoryClient";
import { queryRecords } from "@/lib/crm/zohoClient";

const STALE_DEAL_DAYS = 14;
const TOP_DRIVERS_COUNT = 3;

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
  narrative: string | null;
  overdueInvoices: { items: DigestOverdueInvoice[]; totalBalance: { currencyCode: string; sum: number; count: number }[] };
  lowStockItems: DigestLowStockItem[];
  staleDeals: DigestStaleDeal[];
  errors: string[];
}

function topOverdueCustomers(invoices: DigestOverdueInvoice[]): { name: string; currencyCode: string; total: number }[] {
  const totals = new Map<string, { name: string; currencyCode: string; total: number }>();

  for (const inv of invoices) {
    const name = typeof inv.customerName === "string" ? inv.customerName : "Unknown customer";
    const currencyCode = typeof inv.currencyCode === "string" ? inv.currencyCode : "";
    const balance = Number(inv.balance);
    if (Number.isNaN(balance)) continue;

    const key = `${name}|${currencyCode}`;
    const existing = totals.get(key) ?? { name, currencyCode, total: 0 };
    existing.total += balance;
    totals.set(key, existing);
  }

  return [...totals.values()].sort((a, b) => b.total - a.total).slice(0, TOP_DRIVERS_COUNT);
}

/**
 * One plain-English sentence summarizing what needs attention most — the
 * only AI-generated part of the digest. Given ONLY the already-computed
 * exact numbers (never raw record data) and told explicitly not to invent
 * figures, so it can phrase a takeaway without being trusted to do any of
 * the actual math itself. Best-effort: a failure here just omits the
 * sentence, it never blocks the rest of the (fully deterministic) digest.
 */
async function buildNarrative(digest: Omit<Digest, "narrative">): Promise<string | null> {
  const facts = {
    overdueInvoiceCount: digest.overdueInvoices.items.length,
    overdueTotals: digest.overdueInvoices.totalBalance,
    topOverdueCustomers: topOverdueCustomers(digest.overdueInvoices.items),
    lowStockItemCount: digest.lowStockItems.length,
    staleDealCount: digest.staleDeals.length,
    staleDealDaysThreshold: STALE_DEAL_DAYS,
  };

  // Nothing to summarize — every section is clean.
  if (facts.overdueInvoiceCount === 0 && facts.lowStockItemCount === 0 && facts.staleDealCount === 0) {
    return "Everything looks clean today — no overdue invoices, low stock, or stale deals.";
  }

  try {
    const res = await getGemini().models.generateContent({
      model: CHAT_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Write exactly ONE plain-English sentence (max 25 words, no markdown) summarizing what most needs attention today, based ONLY on these exact numbers — never invent or estimate a number not given here:\n${JSON.stringify(facts)}`,
            },
          ],
        },
      ],
    });
    const text = res.text?.trim();
    return text || null;
  } catch {
    // Best-effort — the numeric digest above is unaffected either way.
    return null;
  }
}

/**
 * Computed deterministically from live Zoho data — no LLM involved. This is
 * a "what needs attention" dashboard, not a chat answer, so it runs the same
 * three fixed checks every time rather than letting a model decide what to
 * look at. Each section fails independently (one Zoho hiccup shouldn't blank
 * the whole digest) and gets logged into `errors` instead of throwing.
 */
async function fetchDigest(): Promise<Digest> {
  const errors: string[] = [];

  const cutoff = new Date(Date.now() - STALE_DEAL_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 19) + "+00:00";

  // These three hit three independent Zoho products (Books, Inventory, CRM)
  // — nothing here depends on another's result, so fetching them one after
  // another was pure wasted latency. Run concurrently instead. Inventory in
  // particular pages through the full item catalog to check every item's
  // stock level (Zoho has no server-side "low stock only" filter), which is
  // the main remaining cost — see buildDigest's cache below for how that's
  // kept off the hot path for repeat page visits.
  const [overdueInvoices, items, staleDealsResult] = await Promise.all([
    listBooksRecords("invoices", { status: "overdue" }).catch((err) => {
      errors.push(`Overdue invoices: ${err instanceof Error ? err.message : "failed"}`);
      return { records: [], hasMorePage: false, amountSummary: undefined };
    }),
    listInventoryRecords("items", {}).catch((err) => {
      errors.push(`Inventory items: ${err instanceof Error ? err.message : "failed"}`);
      return { records: [], hasMorePage: false };
    }),
    queryRecords(
      "Deals",
      `select id, Deal_Name, Amount, Stage, Modified_Time from Deals where Modified_Time < '${cutoff}' and Stage not in ('Closed Won', 'Closed Lost') order by Modified_Time asc limit 20`,
    ).catch((err) => {
      errors.push(`Stale deals: ${err instanceof Error ? err.message : "failed"}`);
      return { records: [], moreRecords: false, amountSum: undefined };
    }),
  ]);

  const digestWithoutNarrative = {
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

  return { ...digestWithoutNarrative, narrative: await buildNarrative(digestWithoutNarrative) };
}

const CACHE_TTL_MS = 2 * 60 * 1000;
let cache: { data: Digest; expiresAt: number } | undefined;

/**
 * Every field here is live Zoho data, but "live" doesn't have to mean
 * "re-fetched on every single page open" — the full build takes a few
 * seconds (mostly paging through the Inventory catalog to check stock
 * levels, since Zoho has no server-side "low stock only" filter). Caching
 * for a couple of minutes means only the first visit (or an explicit
 * Refresh) pays that cost; anyone else opening the page in that window gets
 * an instant response that's still at most 2 minutes stale.
 */
export async function buildDigest(forceRefresh = false): Promise<Digest> {
  if (!forceRefresh && cache && cache.expiresAt > Date.now()) {
    return cache.data;
  }

  const data = await fetchDigest();
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}
