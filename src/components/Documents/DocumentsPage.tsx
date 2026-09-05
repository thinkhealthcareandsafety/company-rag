"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TopNav } from "@/components/TopNav";

interface DocumentRow {
  id: string;
  filename: string;
  status: "processing" | "ready" | "failed";
  failureReason: string | null;
  createdAt: string;
}

const STATUS_COLOR: Record<DocumentRow["status"], string> = {
  processing: "var(--text-muted)",
  ready: "var(--success)",
  failed: "var(--danger)",
};

export function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/documents");
    if (res.ok) setDocs(await res.json());
  }, []);

  useEffect(() => {
    // refresh() sets state after an awaited fetch resolves, not synchronously;
    // this is the standard fetch-on-mount-and-poll pattern for a status list
    // with no framework-level data layer (React Query, etc.) in this project.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    // Poll while anything is still processing, so status flips to ready/failed
    // without a manual refresh.
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/documents", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(body.error ?? "Upload failed");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <>
      <TopNav />
      <main style={{ maxWidth: 800, width: "100%", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Documents</h1>
          <label className="btn btn-primary">
            {uploading ? "Uploading…" : "Upload PDF"}
            <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleUpload} disabled={uploading} style={{ display: "none" }} />
          </label>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="card">
          {docs.length === 0 && <p style={{ padding: "1rem", color: "var(--text-muted)" }}>No documents uploaded yet.</p>}
          {docs.map((doc, i) => (
            <div
              key={doc.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.75rem 1rem",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
              }}
            >
              <div>
                <div style={{ fontSize: "0.9rem" }}>{doc.filename}</div>
                <div style={{ fontSize: "0.78rem", color: STATUS_COLOR[doc.status] }}>
                  {doc.status}
                  {doc.status === "failed" && doc.failureReason ? ` — ${doc.failureReason}` : ""}
                </div>
              </div>
              <button className="btn" onClick={() => handleDelete(doc.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
