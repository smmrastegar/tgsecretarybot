"use client";

import { createContext, useContext, type ReactNode } from "react";

export type SourceAccount = { id: number; name: string };
/** The connected Spotify accounts (owner views only; empty for everyone else, which hides the marks). */
export const AccountsCtx = createContext<SourceAccount[]>([]);

/** Tiny, dim initials of the Spotify account(s) a song came from. Hover / long-press shows the full name. */
export function SourceMarks({ ids, size = "sm" }: { ids?: number[]; size?: "sm" | "md" }) {
  const accounts = useContext(AccountsCtx);
  if (!ids?.length || accounts.length === 0) return null;
  const clean = (n: string) => n.replace(/[^\p{L}\p{N}]/gu, "");
  const mark = (n: string, len: number) => clean(n).slice(0, len).toUpperCase() || "?";
  const mine = accounts.filter((a) => ids.includes(a.id));
  if (mine.length === 0) return null;
  const lab = (a: SourceAccount) => mark(a.name, accounts.filter((x) => mark(x.name, 1) === mark(a.name, 1)).length > 1 ? 2 : 1);
  const cls = size === "md" ? "text-[10px] leading-[13px] px-1 rounded" : "text-[8px] leading-[10px] px-[3px] rounded-[3px]";
  return (
    <span className="inline-flex shrink-0 gap-0.5 align-middle" dir="ltr">
      {mine.map((a) => <span key={a.id} title={a.name} aria-label={`From ${a.name}`} className={`${cls} border border-current opacity-45`}>{lab(a)}</span>)}
    </span>
  );
}

/** A title that truncates on its own while the account marks stay visible right after it (never cut off, however many artists the song has). */
export function TitleLine({ title, ids, className = "", size }: { title: ReactNode; ids?: number[]; className?: string; size?: "sm" | "md" }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={`truncate ${className}`}>{title}</span>
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
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" dir="ltr" aria-label="Spotify accounts that have this song">
      {mine.map((a) => (
        <span key={a.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-current py-0.5 pl-1 pr-2.5 text-[12px] leading-4 opacity-60">
          <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-current/20 text-[9px] font-bold">{(a.name.replace(/[^\p{L}\p{N}]/gu, "")[0] ?? "?").toUpperCase()}</span>
          <span className="break-words">{a.name}</span>
        </span>
      ))}
    </div>
  );
}
