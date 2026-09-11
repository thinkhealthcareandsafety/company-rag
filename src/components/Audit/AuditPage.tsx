"use client";

import { useCallback, useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { PageLoader } from "@/components/Loader";

interface AuditLogRow {
  id: string;
  action: string;
  detail: Record<string, unknown> | null;
  ok: number;
  createdAt: string;
  userEmail: string | null;
  userName: string | null;
}

function summarizeDetail(detail: Record<string, unknown> | null): string {
  if (!detail) return "";
  const parts: string[] = [];
  if (detail.module) parts.push(String(detail.module));
  if (detail.recordId) parts.push(`#${detail.recordId}`);
  if (detail.name) parts.push(`“${detail.name}”`);
  if (detail.query) parts.push(`“${detail.query}”`);
  if (detail.searchText) parts.push(`“${detail.searchText}”`);
  if (typeof detail.resultCount === "number") parts.push(`${detail.resultCount} result${detail.resultCount === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export function AuditPage() {
  const [rows, setRows] = useState<AuditLogRow[] | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/audit");
    if (res.ok) setRows(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <>
      <TopNav />
      <main style={{ maxWidth: 800, width: "100%", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 0.5rem" }}>Audit log</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>
          Every document search and live CRM/Books/Inventory lookup the assistant has made — who asked, what it
          touched, and whether it succeeded. The most recent 200 entries. This record is never cleared.
        </p>

        <div className="card">
          {rows === null ? (
            <PageLoader />
          ) : rows.length === 0 ? (
            <p style={{ padding: "1rem", color: "var(--text-muted)" }}>No tool calls logged yet.</p>
          ) : (
            rows.map((r, i) => (
              <div
                key={r.id}
                style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                  padding: "0.65rem 1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "1rem",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "0.88rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <span style={{ fontWeight: 600 }}>{r.action}</span>
                    {!r.ok && <span style={{ color: "var(--danger)", fontSize: "0.75rem" }}>failed</span>}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {summarizeDetail(r.detail)}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  <div>{r.userName ?? r.userEmail ?? "unknown user"}</div>
                  <div>{new Date(r.createdAt).toLocaleString()}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </>
  );
}
