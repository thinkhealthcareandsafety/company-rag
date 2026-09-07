"use client";

import { useCallback, useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { PageLoader } from "@/components/Loader";

interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

export function TeamPage() {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/team");
    if (res.ok) setMembers(await res.json());
  }, []);

  useEffect(() => {
    // refresh() sets state after an awaited fetch resolves, not synchronously
    // — the standard fetch-on-mount pattern used across this app's pages.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to create account" }));
        throw new Error(typeof body.error === "string" ? body.error : "Failed to create account");
      }
      setEmail("");
      setPassword("");
      setName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    const res = await fetch(`/api/team/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Failed to remove account" }));
      setError(typeof body.error === "string" ? body.error : "Failed to remove account");
      return;
    }
    await refresh();
  }

  return (
    <>
      <TopNav />
      <main style={{ maxWidth: 800, width: "100%", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 0.5rem" }}>Team</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>
          Give each teammate their own login so conversation history stays private per person, instead of everyone
          sharing one account.
        </p>

        {error && <p className="error-text">{error}</p>}

        <form onSubmit={handleCreate} className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="team-email">Email</label>
            <input id="team-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="team-name">Name (optional)</label>
            <input id="team-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="team-password">Password</label>
            <input
              id="team-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving} style={{ alignSelf: "flex-start" }}>
            {saving ? "Adding…" : "Add teammate"}
          </button>
        </form>

        <div className="card">
          {members === null ? (
            <PageLoader />
          ) : members.length === 0 ? (
            <p style={{ padding: "1rem", color: "var(--text-muted)" }}>No accounts yet.</p>
          ) : (
            members.map((m, i) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.75rem 1rem",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                }}
              >
                <div>
                  <div style={{ fontSize: "0.9rem" }}>{m.name || m.email}</div>
                  {m.name && <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{m.email}</div>}
                </div>
                <button className="btn" onClick={() => handleDelete(m.id)}>
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      </main>
    </>
  );
}
