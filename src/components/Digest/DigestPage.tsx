"use client";

import { useCallback, useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { PageLoader } from "@/components/Loader";
import type { Digest } from "@/lib/digest";

const SECTION_STYLE: React.CSSProperties = { marginBottom: "1.5rem" };
const SECTION_TITLE_STYLE: React.CSSProperties = { fontSize: "1rem", fontWeight: 700, margin: "0 0 0.75rem" };
const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "1rem",
  padding: "0.75rem 1rem",
};

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

  return (
    <>
      <TopNav />
      <main style={{ maxWidth: 800, width: "100%", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Digest</h1>
          <button className="btn" onClick={handleRefresh} disabled={refreshing || digest === null}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>
          What needs attention right now — overdue invoices, low stock, and deals gone quiet — without having to ask.
        </p>

        {error && <p className="error-text">{error}</p>}

        {digest === null ? (
          <PageLoader />
        ) : (
          <>
            {digest.errors.length > 0 && (
              <p className="error-text">Some sections couldn&rsquo;t load: {digest.errors.join("; ")}</p>
            )}

            <section style={SECTION_STYLE}>
              <h2 style={SECTION_TITLE_STYLE}>
                Overdue invoices ({digest.overdueInvoices.items.length})
                {digest.overdueInvoices.totalBalance.map((t) => (
                  <span key={t.currencyCode} style={{ fontWeight: 500, color: "var(--text-muted)", marginLeft: "0.5rem" }}>
                    · {t.currencyCode} {t.sum.toLocaleString()} owed
                  </span>
                ))}
              </h2>
              <div className="card">
                {digest.overdueInvoices.items.length === 0 ? (
                  <p style={{ padding: "1rem", color: "var(--text-muted)", margin: 0 }}>No overdue invoices.</p>
                ) : (
                  digest.overdueInvoices.items.map((inv, i) => (
                    <div key={inv.id} style={{ ...ROW_STYLE, borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
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
                  ))
                )}
              </div>
            </section>

            <section style={SECTION_STYLE}>
              <h2 style={SECTION_TITLE_STYLE}>Low stock ({digest.lowStockItems.length})</h2>
              <div className="card">
                {digest.lowStockItems.length === 0 ? (
                  <p style={{ padding: "1rem", color: "var(--text-muted)", margin: 0 }}>No low-stock items.</p>
                ) : (
                  digest.lowStockItems.map((item, i) => (
                    <div key={item.id} style={{ ...ROW_STYLE, borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "0.9rem" }}>{String(item.name ?? "Unknown item")}</div>
                        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>SKU {String(item.sku ?? "—")}</div>
                      </div>
                      <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--danger)", flexShrink: 0 }}>
                        {String(item.stockOnHand ?? 0)} left (reorder at {String(item.reorderLevel ?? 0)})
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section style={SECTION_STYLE}>
              <h2 style={SECTION_TITLE_STYLE}>Deals gone quiet ({digest.staleDeals.length})</h2>
              <div className="card">
                {digest.staleDeals.length === 0 ? (
                  <p style={{ padding: "1rem", color: "var(--text-muted)", margin: 0 }}>No stale deals.</p>
                ) : (
                  digest.staleDeals.map((deal, i) => (
                    <div key={deal.id} style={{ ...ROW_STYLE, borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
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
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}
