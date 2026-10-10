"use client";

import { useMemo, useState } from "react";
import Section, { Pill } from "./Section";

export type SpCfg = { hasCredentials: boolean; clientId: string; accounts: Array<{ id: number; displayName: string | null; spotifyUserId: string }>; redirectUri: string };
export type SpLib = { playlists: Array<{ id: string; name: string; tracks: number; owner: string }>; likedCount: number; me: string };

const fa = (v: number) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
const btn = "min-h-11 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] disabled:opacity-50";
const field = "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3";

// Spotify connection: accounts as rows, two big actions, and the (long) list of lists folded until asked for.
export default function SpotifySection(p: {
  sp: SpCfg | null; spLib: SpLib | null; acct: number | null; canManage: boolean;
  note: { ok: boolean; text: string } | null; error: string | null; busy: string | null;
  syncBusy: boolean; syncMsg: string; importMsg: string | null;
  cid: string; csec: string; setCid: (v: string) => void; setCsec: (v: string) => void;
  onSaveCreds: () => void; onSelect: (id: number) => void; onDisconnect: (id: number) => void;
  onSync: () => void; onImport: (id: string, name: string) => void; onConnect: () => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const [q, setQ] = useState("");
  const accounts = p.sp?.accounts ?? [];
  const lists = useMemo(() => {
    const all = p.spLib?.playlists ?? [];
    const s = q.trim().toLowerCase();
    return s ? all.filter((l) => l.name.toLowerCase().includes(s)) : all;
  }, [p.spLib, q]);
  const status = p.note?.text ?? p.importMsg ?? (p.syncMsg || null);
  const needsSetup = p.sp && (accounts.length === 0 || !p.sp.hasCredentials);

  return (
    <Section icon="🟢" title="اتصال به اسپاتیفای" defaultOpen
      summary={p.sp ? (accounts.length ? accounts.map((a) => a.displayName ?? a.spotifyUserId).join(" · ") : "هنوز حسابی وصل نیست") : "…"}
      badge={accounts.length ? <Pill tone="ok">{fa(accounts.length)} حساب</Pill> : undefined}>
      {status && <div role="status" className={`mb-3 rounded-xl border px-3 py-2.5 text-xs leading-6 ${p.note && !p.note.ok ? "border-rose-400/50 text-rose-300" : "border-[#1db954]/50 text-[#1db954]"}`}>{status}</div>}

      {needsSetup && p.canManage && (
        <div className="mb-4 space-y-2 text-xs text-[var(--color-text-dim)] leading-6">
          <p>یک‌بار: در developer.spotify.com/dashboard یک App بساز، این آدرس را به‌عنوان Redirect URI ثبت کن و Client ID / Secret را اینجا بده.</p>
          <div dir="ltr" className="font-mono text-[11px] bg-[var(--color-surface-2)] rounded-lg px-3 py-2 select-all break-all">{p.sp?.redirectUri}</div>
          <input dir="ltr" value={p.cid} onChange={(e) => p.setCid(e.target.value)} placeholder="Client ID" className={field} />
          <input dir="ltr" type="password" value={p.csec} onChange={(e) => p.setCsec(e.target.value)} placeholder={p.sp?.hasCredentials ? "Client Secret (ذخیره شده)" : "Client Secret"} className={field} />
          <button onClick={p.onSaveCreds} className={`${btn} w-full`}>ذخیره</button>
        </div>
      )}
      {needsSetup && !p.canManage && <p className="mb-4 text-xs text-[var(--color-text-dim)] leading-6">تنظیم اپ اسپاتیفای فقط از داشبورد اصلی انجام می‌شود.</p>}

      {p.sp?.hasCredentials && (
        <>
          {accounts.length > 0 && (
            <ul className="space-y-2">
              {accounts.map((a) => {
                const on = p.acct === a.id, name = a.displayName ?? a.spotifyUserId;
                return (
                  <li key={a.id} className={`flex items-center gap-2 rounded-2xl border p-2 ${on ? "border-[#1db954]/60 bg-[#1db954]/10" : "border-[var(--color-border)]"}`}>
                    <button onClick={() => p.onSelect(a.id)} aria-pressed={on} className="flex items-center gap-3 min-w-0 flex-1 min-h-12 text-start rounded-xl">
                      <span aria-hidden className={`grid place-items-center w-10 h-10 rounded-full text-base font-semibold shrink-0 bg-[var(--color-surface-2)] ${on ? "ring-2 ring-[#1db954] text-[#1db954]" : ""}`}>{(name.replace(/[^\p{L}\p{N}]/gu, "")[0] ?? "?").toUpperCase()}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate" dir="auto">{name}</span>
                        <span className="block text-[11px] text-[var(--color-text-dim)]">{on ? "حساب فعلی ✓" : "برای انتخاب بزن"}</span>
                      </span>
                    </button>
                    {p.canManage && <button onClick={() => p.onDisconnect(a.id)} className="shrink-0 min-h-10 px-3 rounded-xl text-xs text-rose-300 border border-rose-500/30 active:bg-rose-500/10">قطع</button>}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={p.onConnect} className="min-h-11 px-3 rounded-xl bg-[#1db954] text-black text-sm font-semibold active:opacity-80">{accounts.length ? "+ افزودن حساب" : "ورود با اسپاتیفای"}</button>
            <button disabled={p.syncBusy || accounts.length === 0} onClick={p.onSync} className={btn}>{p.syncBusy ? "در حال بررسی…" : "↻ همگام‌سازی"}</button>
          </div>
          <p className="mt-2 text-[11px] text-[var(--color-text-dim)] leading-6">لیست‌های واردشده هر ساعت خودکار بررسی می‌شوند و آهنگ جدید دانلود می‌شود.</p>
          {p.error && <div className="mt-2 text-xs text-rose-300">{p.error}</div>}

          {accounts.length > 0 && (
            <div className="mt-3 rounded-2xl border border-[var(--color-border)] overflow-hidden">
              <button onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen} className="w-full min-h-12 px-4 flex items-center gap-2 text-sm text-start active:bg-[var(--color-surface-2)]">
                <span aria-hidden>📋</span>
                <span className="flex-1 min-w-0 truncate">لیست‌های {p.spLib ? <bdi dir="auto">«{p.spLib.me}»</bdi> : "حساب"}</span>
                <Pill>{p.spLib ? fa(p.spLib.playlists.length + 1) : "…"}</Pill>
                <span aria-hidden className="text-[var(--color-text-dim)]">{listOpen ? "▴" : "▾"}</span>
              </button>
              {listOpen && (
                <div className="border-t border-[var(--color-border)]">
                  {!p.spLib && !p.error && <div className="px-4 py-3 text-xs text-[var(--color-text-dim)]">در حال خواندن…</div>}
                  {p.spLib && (
                    <>
                      <div className="p-2"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی لیست…" aria-label="جستجوی لیست" className={field} /></div>
                      <p className="px-4 pb-2 text-[11px] text-[var(--color-text-dim)]">روی هر لیست بزن تا آهنگ‌هایش وارد صف دانلود شود.</p>
                      <ul className="max-h-[50vh] overflow-y-auto overscroll-contain divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
                        {(!q.trim() || "لایک‌ها liked".includes(q.trim().toLowerCase())) && (
                          <li><Row busy={p.busy === "liked"} disabled={!!p.busy} onClick={() => p.onImport("liked", `لایک‌ها (${p.spLib!.me})`)} name="♥ لایک‌ها" count={p.spLib.likedCount} accent /></li>
                        )}
                        {lists.map((l) => <li key={l.id}><Row busy={p.busy === l.id} disabled={!!p.busy} onClick={() => p.onImport(l.id, l.name)} name={l.name} count={l.tracks} /></li>)}
                        {lists.length === 0 && q.trim() && <li className="px-4 py-3 text-xs text-[var(--color-text-dim)]">چیزی پیدا نشد.</li>}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function Row({ name, count, onClick, busy, disabled, accent }: { name: string; count: number; onClick: () => void; busy: boolean; disabled: boolean; accent?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="w-full min-h-12 px-4 flex items-center gap-3 text-start active:bg-[var(--color-surface-2)] disabled:opacity-60">
      <span className={`flex-1 min-w-0 truncate text-sm ${accent ? "text-[#1db954] font-medium" : ""}`} dir="auto">{name}</span>
      {count >= 0 && <span className="text-[11px] text-[var(--color-text-dim)] tabular-nums shrink-0">{fa(count)}</span>}
      <span className="shrink-0 text-xs text-[var(--color-text-dim)] w-14 text-end">{busy ? "…" : "↓ وارد کن"}</span>
    </button>
  );
}
