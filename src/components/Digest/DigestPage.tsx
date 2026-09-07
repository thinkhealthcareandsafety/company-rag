"use client";

import { useCallback, useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { PageLoader } from "@/components/Loader";
import type { Digest } from "@/lib/digest";

const SECTION_TITLE_STYLE: React.CSSProperties = { fontSize: "1rem", fontWeight: 700, margin: "0 0 0.75rem" };
const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "1rem",
  padding: "0.75rem 1rem",
};
const PREVIEW_COUNT = 5;

interface StatCardProps {
  label: string;
  value: string;
  detail?: string;
  tone: "ok" | "warn" | "danger";
}

function StatCard({ label, value, detail, tone }: StatCardProps) {
  const toneColor = tone === "ok" ? "var(--success)" : tone === "danger" ? "var(--danger)" : "#b8860b";
  return (
    <div className="card" style={{ flex: "1 1 180px", padding: "1.1rem 1.25rem", borderTop: `3px solid ${toneColor}` }}>
      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.7rem", fontWeight: 700, color: toneColor, margin: "0.25rem 0 0.1rem", letterSpacing: "-0.02em" }}>
        {value}
      </div>
      {detail && <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{detail}</div>}
    </div>
  );
}

function ExpandableList<T extends { id: string }>({
  items,
  emptyLabel,
  renderRow,
}: {
  items: T[];
  emptyLabel: string;
  renderRow: (item: T) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, PREVIEW_COUNT);

  return (
    <div className="card">
      {items.length === 0 ? (
        <p style={{ padding: "1rem", color: "var(--text-muted)", margin: 0 }}>{emptyLabel}</p>
      ) : (
        <>
          {visible.map((item, i) => (
            <div key={item.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
              {renderRow(item)}
            </div>
          ))}
          {items.length > PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              style={{
                width: "100%",
                textAlign: "center",
                padding: "0.65rem",
                background: "none",
                border: "none",
                borderTop: "1px solid var(--border)",
                color: "var(--accent-2)",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {expanded ? "Show less" : `Show all ${items.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function DigestPage() {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/digest");
      if (!res.ok) throw new Error("Failed to load digest");
      setDigest(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load digest");
    }
  }, []);

  useEffect(() => {
    // refresh() sets state after an awaited fetch resolves, not synchronously
    // — the standard fetch-on-mount pattern used across this app's pages.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  async function handleRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  const overdueTotal = digest?.overdueInvoices.totalBalance
    .map((t) => `${t.currencyCode} ${t.sum.toLocaleString()}`)
    .join(" + ");

  return (
    <>
      <TopNav />
      <main style={{ maxWidth: 960, width: "100%", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Digest</h1>
          <button className="btn" onClick={handleRefresh} disabled={refreshing || digest === null}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>
          What needs attention right now — at a glance, without having to ask.
        </p>

        {error && <p className="error-text">{error}</p>}

        {digest === null ? (
          <PageLoader />
        ) : (
          <>
            {digest.errors.length > 0 && (
              <p className="error-text">Some sections couldn&rsquo;t load: {digest.errors.join("; ")}</p>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.85rem", marginBottom: "2rem" }}>
              <StatCard
                label="Overdue invoices"
                value={String(digest.overdueInvoices.items.length)}
                detail={overdueTotal ? `${overdueTotal} owed` : undefined}
                tone={digest.overdueInvoices.items.length === 0 ? "ok" : "danger"}
              />
              <StatCard
                label="Low stock items"
                value={String(digest.lowStockItems.length)}
                detail={digest.lowStockItems.length === 0 ? "All stocked" : "Below reorder level"}
                tone={digest.lowStockItems.length === 0 ? "ok" : "warn"}
              />
              <StatCard
                label="Deals gone quiet"
                value={String(digest.staleDeals.length)}
                detail={digest.staleDeals.length === 0 ? "All active" : "No activity 14+ days"}
                tone={digest.staleDeals.length === 0 ? "ok" : "warn"}
              />
            </div>

            <section style={{ marginBottom: "1.5rem" }}>
              <h2 style={SECTION_TITLE_STYLE}>Overdue invoices</h2>
              <ExpandableList
                items={digest.overdueInvoices.items}
                emptyLabel="No overdue invoices."
                renderRow={(inv) => (
                  <div style={ROW_STYLE}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "0.9rem" }}>{String(inv.customerName ?? "Unknown customer")}</div>
                      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                        Invoice {String(inv.invoiceNumber ?? "")} · due {String(inv.dueDate ?? "")}
                      </div>
                    </div>
                    <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--danger)", flexShrink: 0 }}>
                      {String(inv.currencyCode ?? "")} {String(inv.balance ?? "")}
                    </div>
                  </div>
                )}
              />
            </section>

            <section style={{ marginBottom: "1.5rem" }}>
              <h2 style={SECTION_TITLE_STYLE}>Low stock</h2>
              <ExpandableList
                items={digest.lowStockItems}
                emptyLabel="No low-stock items."
                renderRow={(item) => (
                  <div style={ROW_STYLE}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "0.9rem" }}>{String(item.name ?? "Unknown item")}</div>
                      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>SKU {String(item.sku ?? "—")}</div>
                    </div>
                    <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--danger)", flexShrink: 0 }}>
                      {String(item.stockOnHand ?? 0)} left (reorder at {String(item.reorderLevel ?? 0)})
                    </div>
                  </div>
                )}
              />
            </section>

            <section style={{ marginBottom: "1.5rem" }}>
              <h2 style={SECTION_TITLE_STYLE}>Deals gone quiet</h2>
              <ExpandableList
                items={digest.staleDeals}
                emptyLabel="No stale deals."
                renderRow={(deal) => (
                  <div style={ROW_STYLE}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "0.9rem" }}>{String(deal.dealName ?? "Unnamed deal")}</div>
                      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                        {String(deal.stage ?? "")} · last updated {String(deal.modifiedTime ?? "").slice(0, 10)}
                      </div>
                    </div>
                    {deal.amount !== undefined && deal.amount !== null && (
                      <div style={{ fontSize: "0.9rem", fontWeight: 600, flexShrink: 0 }}>{String(deal.amount)}</div>
                    )}
                  </div>
                )}
              />
            </section>
          </>
        )}
      </main>
    </>
  );
}
