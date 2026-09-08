"use client";

import { MenuIcon } from "@/components/icons";
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
          <img src="/logo.jpg" alt="think health" />
        </span>
        <span className="brand-name" title="think health">
          think health
        </span>
      </span>
    </header>
  );
}
