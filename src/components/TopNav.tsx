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
        <span className="brand-name" title="Think Healthcare & Safety">
          <span className="brand-name-full">Think Healthcare &amp; Safety</span>
          <span className="brand-name-short">THS</span>
        </span>
      </span>
      <nav>
        <Link href="/">Chat</Link>
        <Link href="/documents">Documents</Link>
        <Link href="/shortcuts">Shortcuts</Link>
        <Link href="/team">Team</Link>
        <Link href="/errors">Errors</Link>
        {session?.user?.email && <span className="nav-email">{session.user.email}</span>}
        <button className="btn" onClick={() => signOut({ callbackUrl: "/login" })}>
          Sign out
        </button>
      </nav>
    </header>
  );
}
