"use client";

import { createContext, useContext, type ReactNode } from "react";

export type SourceAccount = { id: number; name: string };
/** The connected Spotify accounts (owner views only; empty for everyone else, which hides the marks). */
export const AccountsCtx = createContext<SourceAccount[]>([]);

export type AccountKind = "spotify" | "soundcloud" | "direct";
export const accountKind = (a: SourceAccount): AccountKind => (a.id >= 1_000_000 ? "soundcloud" : a.id > 0 ? "spotify" : "direct");
/** One colour per app: Spotify green, SoundCloud orange, files added by hand grey. */
export const KIND_COLOR: Record<AccountKind, string> = { spotify: "#1db954", soundcloud: "#ff5500", direct: "#8b8b95" };
const words = (n: string) => n.replace(/\s*\(SoundCloud\)\s*$/i, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** A three-letter summary of an account: initials of its words ("Mohammad Mahdi Rastegar" → MMR), or its first letters for a short name. */
export function shortCode(name: string): string {
  const w = words(name);
  if (w.length === 0) return "?";
  const up = (x: string) => x.toUpperCase();
  if (w.length >= 3) return up(w.slice(0, 3).map((x) => x[0]).join(""));
  if (w.length === 2) return up(`${w[0]![0]}${w[1]![0]}${w[1]![1] ?? w[0]![1] ?? ""}`);
  return up(w[0]!.slice(0, 3));
}
/** Codes for a whole list: when two accounts of the same app would get the same letters, the later ones take their first three letters, then a number. */
export function accountCodes(list: SourceAccount[]): Map<number, string> {
  const out = new Map<number, string>(), taken = new Set<string>();
  for (const a of list) {
    const k = accountKind(a);
    let c = shortCode(a.name);
    if (taken.has(`${k}:${c}`)) c = words(a.name).join("").slice(0, 3).toUpperCase() || c;
    for (let i = 2; taken.has(`${k}:${c}`); i++) c = `${c.slice(0, 2)}${i}`;
    taken.add(`${k}:${c}`); out.set(a.id, c);
  }
  return out;
}

/** The app's mark in its own single colour. */
export function AppIcon({ kind, size = 14, color }: { kind: AccountKind; size?: number; color?: string }) {
  const c = color ?? KIND_COLOR[kind];
  if (kind === "spotify") return (<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0"><circle cx="12" cy="12" r="11" fill={c} /><path d="M6.3 9.3c3.9-1.2 8.7-.9 12 1.1M7 12.7c3.3-.9 7-.6 9.8.9M7.9 15.8c2.7-.7 5.3-.4 7.5.9" stroke="#0b0b0f" strokeWidth="1.7" strokeLinecap="round" fill="none" /></svg>);
  if (kind === "soundcloud") return (<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0"><path d="M8.2 18.5h9.6a3.8 3.8 0 0 0 .5-7.57A5.6 5.6 0 0 0 8.4 9.3a4.6 4.6 0 0 0-.2 9.2z" fill={c} /><path d="M3.2 14v3.6M5.2 12.8v4.8M7 12v5.6" stroke={c} strokeWidth="1.5" strokeLinecap="round" fill="none" /></svg>);
  return (<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0"><path d="M12 3v10.5a3.7 3.7 0 1 0 2 3.3V8h4V3z" fill={c} /></svg>);
}

/** Icon of the account's app + its three-letter code. The full name stays in the tooltip and the accessible label. */
export function AccountBadge({ account, code, size = 14, textClass = "" }: { account: SourceAccount; code: string; size?: number; textClass?: string }) {
  const kind = accountKind(account);
  return (
    <span className="inline-flex items-center gap-1" title={account.name} aria-label={account.name} dir="ltr">
      <AppIcon kind={kind} size={size} />
      <span className={`font-bold tracking-wide ${textClass}`}>{code}</span>
    </span>
  );
}

/** Tiny marks of the account(s) a song came from: the app's own colour icon + a three-letter code. Hover / long-press shows the full name. */
export function SourceMarks({ ids, size = "sm" }: { ids?: number[]; size?: "sm" | "md" }) {
  const accounts = useContext(AccountsCtx);
  if (!ids?.length || accounts.length === 0) return null;
  const mine = accounts.filter((a) => ids.includes(a.id));
  if (mine.length === 0) return null;
  const codes = accountCodes(accounts);
  const cls = size === "md" ? "text-[11px] leading-[14px]" : "text-[10px] leading-[12px]";
  return (
    <span className="inline-flex shrink-0 gap-1.5 align-middle opacity-90" dir="ltr">
      {mine.map((a) => <AccountBadge key={a.id} account={a} code={codes.get(a.id) ?? "?"} size={size === "md" ? 13 : 11} textClass={`${cls} text-[var(--dim2)]`} />)}
    </span>
  );
}

/** A title that truncates on its own while the account marks stay visible right after it (never cut off, however many artists the song has). */
export function TitleLine({ title, ids, className = "", size }: { title: ReactNode; ids?: number[]; className?: string; size?: "sm" | "md" }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span dir="auto" className={`truncate ${className}`}>{title}</span>
      <SourceMarks ids={ids} size={size} />
    </span>
  );
}

/** Roomy places (full-screen player, song details): each account as a small pill with its FULL name, wrapping onto as many lines as needed. */
export function SourceChips({ ids }: { ids?: number[] }) {
  const accounts = useContext(AccountsCtx);
  if (!ids?.length || accounts.length === 0) return null;
  const mine = accounts.filter((a) => ids.includes(a.id));
  if (mine.length === 0) return null;
  const codes = accountCodes(accounts);
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" dir="ltr" aria-label="Accounts that have this song">
      {mine.map((a) => (
        <span key={a.id} className="inline-flex items-center rounded-full border border-[var(--bd)] py-1 pl-2 pr-2.5 text-[12px] leading-4 text-[var(--dim2)]">
          <AccountBadge account={a} code={codes.get(a.id) ?? "?"} size={14} />
        </span>
      ))}
    </div>
  );
}
