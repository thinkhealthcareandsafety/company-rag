"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export function ChatSidebar({ activeId, open, onClose }: { activeId?: string; open: boolean; onClose: () => void }) {
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

  // Selecting a conversation should close the drawer on mobile (it's an
  // overlay there) but leave the sidebar open on desktop (it's a fixed pane).
  function closeOnMobile() {
    if (typeof window !== "undefined" && window.innerWidth < 860) onClose();
  }

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`chat-sidebar ${open ? "open" : ""}`}>
        <div className="chat-sidebar-inner">
          <Link href="/" className="new-chat-btn" onClick={closeOnMobile}>
            + New chat
          </Link>
          <div className="chat-sidebar-list">
            {conversations.map((c) => (
              <Link
                key={c.id}
                href={`/c/${c.id}`}
                className={`chat-sidebar-item ${c.id === activeId ? "active" : ""}`}
                onClick={closeOnMobile}
              >
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
        </div>
      </aside>
    </>
  );
}
