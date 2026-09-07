"use client";

import { useCallback, useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { PageLoader } from "@/components/Loader";

interface ErrorLogRow {
  id: string;
  message: string;
  stack: string | null;
  context: Record<string, unknown> | null;
  createdAt: string;
}

export function ErrorsPage() {
  const [errors, setErrors] = useState<ErrorLogRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/errors");
    if (res.ok) setErrors(await res.json());
  }, []);

  useEffect(() => {
    // refresh() sets state after an awaited fetch resolves, not synchronously
    // — the standard fetch-on-mount pattern used across this app's pages.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleClear() {
    setClearing(true);
    try {
      await fetch("/api/errors", { method: "DELETE" });
      await refresh();
    } finally {
      setClearing(false);
    }
  }

  return (
    <>
      <TopNav />
      <main style={{ maxWidth: 800, width: "100%", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Errors</h1>
          {errors && errors.length > 0 && (
            <button className="btn" onClick={handleClear} disabled={clearing}>
              {clearing ? "Clearing…" : "Clear all"}
            </button>
          )}
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>
          Anything that went wrong answering a question — the most recent 100 failures, newest first.
        </p>

        <div className="card">
          {errors === null ? (
            <PageLoader />
          ) : errors.length === 0 ? (
            <p style={{ padding: "1rem", color: "var(--text-muted)" }}>No errors logged. Everything&rsquo;s been running clean.</p>
          ) : (
            errors.map((e, i) => (
              <div key={e.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                <button
                  type="button"
                  onClick={() => setOpenId(openId === e.id ? null : e.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "1rem",
                    padding: "0.75rem 1rem",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "inherit",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.88rem", color: "var(--danger)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.message}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {new Date(e.createdAt).toLocaleString()}
                      {typeof e.context?.source === "string" ? ` · ${e.context.source}` : ""}
                    </div>
                  </div>
                </button>
                {openId === e.id && (e.stack || e.context) && (
                  <pre
                    style={{
                      margin: "0 1rem 0.75rem",
                      padding: "0.75rem",
                      fontSize: "0.75rem",
                      lineHeight: 1.5,
                      background: "var(--surface-muted, rgba(0,0,0,0.03))",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      overflowX: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {e.stack ?? JSON.stringify(e.context, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </main>
    </>
  );
}
