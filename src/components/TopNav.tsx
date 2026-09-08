"use client";

import { SparkIcon, MenuIcon } from "@/components/icons";
import { SimpleNavDrawer } from "@/components/Sidebar/SimpleNavDrawer";

export function TopNav({ onToggleSidebar, sidebarOpen }: { onToggleSidebar?: () => void; sidebarOpen?: boolean }) {
  return (
    <header className="top-nav">
      <span className="brand">
        {onToggleSidebar ? (
          // Hidden while the sidebar's own header already shows a close (X)
          // button — showing both at once is a confusing double-toggle.
          !sidebarOpen && (
            <button type="button" className="sidebar-toggle-btn" onClick={onToggleSidebar} aria-label="Open sidebar">
              <MenuIcon />
            </button>
          )
        ) : (
          <SimpleNavDrawer />
        )}
        <span className="brand-mark">
          <SparkIcon />
        </span>
        <span className="brand-name" title="Think Healthcare & Safety">
          <span className="brand-name-full">Think Healthcare &amp; Safety</span>
          <span className="brand-name-short">THS</span>
        </span>
      </span>
    </header>
  );
}
