"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertOctagon,
  DollarSign,
  History,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Settings,
  Users2,
} from "lucide-react";

type User = {
  userId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  photoUrl?: string | null;
};

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/urgent", label: "Urgent", icon: AlertOctagon },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/chats", label: "Chats", icon: Users2 },
  { href: "/groups", label: "Groups", icon: Activity },
  { href: "/costs", label: "Costs", icon: DollarSign },
  { href: "/audit", label: "Audit", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.user && setUser(d.user))
      .catch(() => {});
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const display =
    user?.firstName || user?.username || (user ? `user ${user.userId}` : "...");

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="hidden md:flex w-60 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex-col">
        <div className="px-2 pb-4 mb-4 border-b border-[var(--color-border)]">
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">
            tgsecretarybot
          </div>
          <div className="text-sm mt-1">{display}</div>
        </div>
        <nav className="flex-1 flex flex-col gap-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  active
                    ? "bg-[var(--color-surface-2)] text-white"
                    : "text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-white"
                }`}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-white"
        >
          <LogOut size={16} />
          Logout
        </button>
      </aside>

      <header className="md:hidden flex items-center justify-between h-14 px-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] sticky top-0 z-10">
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)]">
            tgsecretarybot
          </span>
          <span className="text-sm">{display}</span>
        </div>
        <button
          onClick={logout}
          aria-label="Logout"
          className="p-2 -mr-2 rounded-md text-[var(--color-text-dim)] hover:text-white"
        >
          <LogOut size={18} />
        </button>
      </header>

      <main className="flex-1 min-w-0 p-4 md:p-8 md:max-w-6xl pb-24 md:pb-8">
        {children}
      </main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[var(--color-surface)] border-t border-[var(--color-border)] flex justify-around items-stretch z-20">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] ${
                active
                  ? "text-white"
                  : "text-[var(--color-text-dim)] hover:text-white"
              }`}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
