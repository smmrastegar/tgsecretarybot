"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertOctagon,
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
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

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
    <div className="flex min-h-screen">
      <aside className="w-60 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col">
        <div className="px-2 pb-4 mb-4 border-b border-[var(--color-border)]">
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">
            tgsecretarybot
          </div>
          <div className="text-sm mt-1">{display}</div>
        </div>
        <nav className="flex-1 flex flex-col gap-1">
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
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
      <main className="flex-1 min-w-0 p-8 max-w-6xl">{children}</main>
    </div>
  );
}
