"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export function ChatSidebar({ activeId }: { activeId?: string }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const pathname = usePathname();
  const router = useRouter();

  const refresh = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) setConversations(await res.json());
  }, []);

  useEffect(() => {
    // refresh() sets state after an awaited fetch resolves, not synchronously
    // — the standard fetch-on-mount pattern used across this app's pages.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh, pathname]);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    await refresh();
    if (id === activeId) router.push("/");
  }

  return (
    <aside className="chat-sidebar">
      <Link href="/" className="new-chat-btn">
        + New chat
      </Link>
      <div className="chat-sidebar-list">
        {conversations.map((c) => (
          <Link key={c.id} href={`/c/${c.id}`} className={`chat-sidebar-item ${c.id === activeId ? "active" : ""}`}>
            <span className="chat-sidebar-title">{c.title}</span>
            <button
              type="button"
              className="chat-sidebar-delete"
              onClick={(e) => handleDelete(e, c.id)}
              aria-label="Delete conversation"
            >
              ×
            </button>
          </Link>
        ))}
      </div>
    </aside>
  );
}
