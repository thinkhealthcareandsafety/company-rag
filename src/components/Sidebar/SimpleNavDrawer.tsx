"use client";

import { useState } from "react";
import Link from "next/link";
import { SidebarHeader, SidebarNavLinks, SidebarFooter } from "@/components/Sidebar/SidebarChrome";
import { MenuIcon } from "@/components/icons";

/**
 * Pages without a persistent chat-history sidebar (Documents, Shortcuts,
 * Team, Errors, Digest) still need the same hamburger-drawer navigation —
 * this manages its own open/close state so those pages don't each need to
 * wire up sidebar state themselves, unlike ChatPage which owns its sidebar
 * because it's a persistent desktop pane, not just an overlay.
 */
export function SimpleNavDrawer() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="sidebar-toggle-btn" onClick={() => setOpen(true)} aria-label="Open menu">
        <MenuIcon />
      </button>
      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} />}
      <aside className={`chat-sidebar simple-drawer ${open ? "open" : ""}`}>
        <div className="chat-sidebar-inner">
          <SidebarHeader onClose={() => setOpen(false)} />
          <Link href="/" className="new-chat-btn" onClick={() => setOpen(false)}>
            + New chat
          </Link>
          <div className="sidebar-divider" />
          <SidebarNavLinks onNavigate={() => setOpen(false)} />
          <SidebarFooter />
        </div>
      </aside>
    </>
  );
}
