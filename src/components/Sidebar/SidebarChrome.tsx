"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { SparkIcon, CloseIcon } from "@/components/icons";

const NAV_LINKS = [
  { href: "/", label: "Chat" },
  { href: "/digest", label: "Digest" },
  { href: "/documents", label: "Documents" },
  { href: "/shortcuts", label: "Shortcuts" },
  { href: "/team", label: "Team" },
  { href: "/errors", label: "Errors" },
];

export function SidebarHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="sidebar-drawer-header">
      <span className="brand">
        <span className="brand-mark">
          <SparkIcon />
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Think Healthcare &amp; Safety
        </span>
      </span>
      <button type="button" className="sidebar-toggle-btn" onClick={onClose} aria-label="Close menu">
        <CloseIcon />
      </button>
    </div>
  );
}

export function SidebarNavLinks({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="sidebar-nav-links">
      {NAV_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          onClick={onNavigate}
          className={`chat-sidebar-item ${pathname === link.href ? "active" : ""}`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function SidebarFooter() {
  const { data: session } = useSession();

  return (
    <div className="sidebar-footer">
      {session?.user?.email && <span className="nav-email">{session.user.email}</span>}
      <button className="btn" onClick={() => signOut({ callbackUrl: "/login" })}>
        Sign out
      </button>
    </div>
  );
}
