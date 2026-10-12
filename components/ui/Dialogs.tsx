"use client";

import { useEffect, useRef, useState } from "react";

// In-app replacements for window.confirm() / window.prompt() (31 native dialogs were used across the
// dashboard; they look like a browser error, block the page and cannot be styled). Call sites keep the same
// shape but await the answer:
//   if (!(await confirmDialog("حذف شود؟", { danger: true, confirmLabel: "حذف" }))) return;
//   const name = await promptDialog("نام جدید:", current);   // null = cancelled
// <DialogHost /> is mounted once in Shell.
type Req =
  | { kind: "confirm"; message: string; title?: string; confirmLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: "prompt"; message: string; initial: string; confirmLabel: string; resolve: (v: string | null) => void };

let push: ((r: Req) => void) | null = null;

export function confirmDialog(message: string, opts: { title?: string; confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  if (!push) return Promise.resolve(window.confirm(message)); // host not mounted (should not happen): fall back
  return new Promise((resolve) => push!({ kind: "confirm", message, title: opts.title, confirmLabel: opts.confirmLabel ?? "تأیید", danger: opts.danger ?? false, resolve }));
}

export function promptDialog(message: string, initial = "", opts: { confirmLabel?: string } = {}): Promise<string | null> {
  if (!push) return Promise.resolve(window.prompt(message, initial));
  return new Promise((resolve) => push!({ kind: "prompt", message, initial, confirmLabel: opts.confirmLabel ?? "ذخیره", resolve }));
}

export function DialogHost() {
  const [queue, setQueue] = useState<Req[]>([]);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const cur = queue[0];

  useEffect(() => { push = (r) => setQueue((q) => [...q, r]); return () => { push = null; }; }, []);
  useEffect(() => { if (cur?.kind === "prompt") { setText(cur.initial); setTimeout(() => input.current?.select(), 30); } }, [cur]);

  const done = (value: boolean | string | null) => {
    if (!cur) return;
    if (cur.kind === "confirm") cur.resolve(Boolean(value)); else cur.resolve(typeof value === "string" ? value : null);
    setQueue((q) => q.slice(1));
  };
  useEffect(() => {
    if (!cur) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") done(cur.kind === "confirm" ? false : null); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `done` only reads `cur`
  }, [cur]);

  if (!cur) return null;
  const danger = cur.kind === "confirm" && cur.danger;
  return (
    <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) done(cur.kind === "confirm" ? false : null); }}>
      <div role="dialog" aria-modal="true" className="w-full md:max-w-sm rounded-t-3xl md:rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 pb-6 text-center shadow-2xl">
        {cur.kind === "confirm" && cur.title && <div className="text-base font-semibold mb-2">{cur.title}</div>}
        <p className="text-sm leading-7 whitespace-pre-line">{cur.message}</p>
        {cur.kind === "prompt" && (
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} dir="auto" aria-label={cur.message}
            onKeyDown={(e) => { if (e.key === "Enter") done(text); }}
            className="mt-3 w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 text-center" />
        )}
        <div className="mt-5 flex gap-2">
          <button type="button" autoFocus={cur.kind === "confirm"} onClick={() => done(cur.kind === "confirm" ? true : text)}
            className={`min-h-11 px-5 rounded-xl text-sm font-medium ${danger ? "bg-rose-500 text-white" : "bg-[var(--color-accent)] text-white"}`}>{cur.confirmLabel}</button>
          <button type="button" onClick={() => done(cur.kind === "confirm" ? false : null)} className="min-h-11 px-5 rounded-xl border border-[var(--color-border)] text-sm">انصراف</button>
        </div>
      </div>
    </div>
  );
}
