"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { SparkIcon, MenuIcon } from "@/components/icons";

export function TopNav({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const { data: session } = useSession();

  return (
    <header className="top-nav">
      <span className="brand">
        {onToggleSidebar && (
          <button type="button" className="sidebar-toggle-btn" onClick={onToggleSidebar} aria-label="Toggle sidebar">
            <MenuIcon />
          </button>
        )}
        <span className="brand-mark">
          <SparkIcon />
        </span>
        Company RAG
      </span>
      <nav>
        <Link href="/">Chat</Link>
        <Link href="/documents">Documents</Link>
        <Link href="/shortcuts">Shortcuts</Link>
        {session?.user?.email && <span className="nav-email">{session.user.email}</span>}
        <button className="btn" onClick={() => signOut({ callbackUrl: "/login" })}>
          Sign out
        </button>
      </nav>
    </header>
  );
}
