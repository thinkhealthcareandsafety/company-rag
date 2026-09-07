"use client";

import { SparkIcon, MenuIcon } from "@/components/icons";
import { SimpleNavDrawer } from "@/components/Sidebar/SimpleNavDrawer";

export function TopNav({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  return (
    <header className="top-nav">
      <span className="brand">
        {onToggleSidebar ? (
          <button type="button" className="sidebar-toggle-btn" onClick={onToggleSidebar} aria-label="Toggle sidebar">
            <MenuIcon />
          </button>
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
