"use client";

import { useCallback, useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";

interface Shortcut {
  id: string;
  trigger: string;
  prompt: string;
}

export function ShortcutsPage() {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [trigger, setTrigger] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/shortcuts");
    if (res.ok) setShortcuts(await res.json());
  }, []);

  useEffect(() => {
    // refresh() sets state after an awaited fetch resolves, not synchronously
    // — the standard fetch-on-mount pattern (see DocumentsPage for the same).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/shortcuts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger, prompt }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to create shortcut" }));
        throw new Error(typeof body.error === "string" ? body.error : "Failed to create shortcut");
      }
      setTrigger("");
      setPrompt("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create shortcut");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/shortcuts/${id}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <>
      <TopNav />
      <main style={{ maxWidth: 800, width: "100%", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 0.5rem" }}>Shortcuts</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>
          Save a full question under a short trigger word. In chat, type <code>/</code> followed by the trigger to
          send it instantly — no retyping long questions.
        </p>

        {error && <p className="error-text">{error}</p>}

        <form onSubmit={handleCreate} className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="trigger">Trigger (no spaces, e.g. &ldquo;IL&rdquo;)</label>
            <input
              id="trigger"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              placeholder="IL"
              maxLength={40}
              required
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="prompt">Full question to send</label>
            <input
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Give me all invoices from yesterday"
              maxLength={2000}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving} style={{ alignSelf: "flex-start" }}>
            {saving ? "Saving…" : "Add shortcut"}
          </button>
        </form>

        <div className="card">
          {shortcuts.length === 0 && <p style={{ padding: "1rem", color: "var(--text-muted)" }}>No shortcuts yet.</p>}
          {shortcuts.map((s, i) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.75rem 1rem",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                gap: "1rem",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>/{s.trigger}</div>
                <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.prompt}
                </div>
              </div>
              <button className="btn" onClick={() => handleDelete(s.id)} style={{ flexShrink: 0 }}>
                Delete
              </button>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
