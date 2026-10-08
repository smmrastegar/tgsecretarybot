"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Card";

// Player links: any number of private links, each with its own playlists.
// Creating a link never touches the others; a link can only be switched off
// (and on again), never deleted.
type Link = { id: number; name: string; url: string; active: boolean; playlistIds: number[] | null; legacy: boolean; canCreate?: boolean; createdAt: string | null; lastUsedAt: string | null };
type Pl = { id: number; name: string; smart: boolean; count: number };

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
const when = (iso: string | null) => (iso ? new Date(iso.replace(" ", "T").replace(/\+00$/, "Z")).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" }) : "—");

export default function LinksCard({ onMessage, refreshKey }: { onMessage: (m: string) => void; refreshKey: number }) {
  const [links, setLinks] = useState<Link[]>([]);
  const [pls, setPls] = useState<Pl[]>([]);
  const [name, setName] = useState("");
  const [pick, setPick] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/music/links", { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as { links: Link[]; playlists: Pl[] };
    setLinks(j.links); setPls(j.playlists);
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const patch = async (id: number, body: Record<string, unknown>) => {
    await fetch(`/api/music/links/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await load();
  };
  async function create() {
    setBusy(true);
    const r = await fetch("/api/music/links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, playlistIds: [...pick] }) });
    setBusy(false);
    if (r.ok) { setName(""); setPick(new Set()); onMessage("لینک جدید ساخته شد؛ لینک‌های قبلی همان‌طور که بودند ماندند"); await load(); }
    else onMessage("ساخت لینک ناموفق بود");
  }
  const toggleIn = (set: Set<number>, id: number) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  return (
    <Card className="mb-4">
      <div className="text-sm font-medium mb-1">🔗 لینک‌های خصوصی پلیر (بدون لاگین)</div>
      <p className="text-xs text-[var(--color-text-dim)] mb-3 leading-6">
        هر لینک یک پلیر جداست و فقط پلی‌لیست‌هایی را می‌بیند که به آن داده‌ای. لینک تازه چیزی را پاک نمی‌کند؛ هر لینک را فقط می‌شود غیرفعال (و دوباره فعال) کرد.
        آدرس‌ها یک کد ۲۵۶ بیتی‌اند، قابل حدس نیستند و ایندکس نمی‌شوند. لینک را فقط برای خودت و دستگاه‌های خودت بفرست.
      </p>

      <div className="space-y-2">
        {links.map((l) => (
          <div key={l.id} className={`rounded-lg border p-3 text-xs ${l.active ? "border-[var(--color-border)]" : "border-[var(--color-border)] opacity-60"}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{l.name}</span>
              <span className={`px-2 py-0.5 rounded-full ${l.active ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>{l.active ? "فعال" : "غیرفعال"}</span>
              <span className="text-[var(--color-text-dim)]">{l.playlistIds == null ? "همه‌ی آهنگ‌ها" : `${fa(l.playlistIds.length)} پلی‌لیست`}</span>
              <span className="ms-auto text-[var(--color-text-dim)]">آخرین استفاده: {when(l.lastUsedAt)}</span>
            </div>
            <input readOnly dir="ltr" value={l.url} onFocus={(e) => e.currentTarget.select()} className="mt-2 w-full text-[11px] font-mono bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5" />
            <div className="mt-2 flex gap-2 flex-wrap">
              <button onClick={() => { void navigator.clipboard.writeText(l.url); onMessage(`لینک «${l.name}» کپی شد`); }} className="px-3 py-1.5 rounded-md border border-[var(--color-border)]">کپی</button>
              <button onClick={() => window.open(l.url, "_blank", "noopener,noreferrer")} disabled={!l.active} className="px-3 py-1.5 rounded-md border border-[var(--color-border)] disabled:opacity-40">باز کردن</button>
              {!l.legacy && <button onClick={() => setOpen(open === l.id ? null : l.id)} className="px-3 py-1.5 rounded-md border border-[var(--color-border)]">پلی‌لیست‌ها {open === l.id ? "▴" : "▾"}</button>}
              {!l.legacy && <button onClick={() => void patch(l.id, { canCreate: !(l.canCreate ?? true) })} title="اجازه‌ی ساخت پلی‌لیست هوشمند از روی یک آهنگ، داخل پلیر" className={`px-3 py-1.5 rounded-md border ${(l.canCreate ?? true) ? "border-[var(--color-accent)]" : "border-[var(--color-border)] opacity-70"}`}>✨ ساخت پلی‌لیست در پلیر: {(l.canCreate ?? true) ? "روشن" : "خاموش"}</button>}
              {!l.legacy && <button onClick={() => { const n = prompt("نام لینک:", l.name); if (n?.trim()) void patch(l.id, { name: n.trim() }); }} className="px-3 py-1.5 rounded-md border border-[var(--color-border)]">نام</button>}
              <button onClick={() => { if (l.active && !confirm(`«${l.name}» غیرفعال شود؟ هر که این لینک را دارد دیگر وارد نمی‌شود (هر وقت خواستی دوباره فعالش کن).`)) return; void patch(l.id, { active: !l.active }); }}
                className={`px-3 py-1.5 rounded-md border ${l.active ? "border-rose-500/40 text-rose-200" : "border-emerald-500/40 text-emerald-200"}`}>{l.active ? "غیرفعال کردن" : "فعال کردن"}</button>
            </div>
            {open === l.id && l.playlistIds && (
              <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex flex-wrap gap-2">
                {pls.length === 0 && <span className="text-[var(--color-text-dim)]">هنوز پلی‌لیستی نساخته‌ای.</span>}
                {pls.map((p) => {
                  const on = l.playlistIds!.includes(p.id);
                  return (
                    <button key={p.id} onClick={() => void patch(l.id, { playlistIds: on ? l.playlistIds!.filter((x) => x !== p.id) : [...l.playlistIds!, p.id] })}
                      className={`px-3 py-1.5 rounded-md border ${on ? "bg-[var(--color-accent)]/20 border-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>{on ? "✓ " : ""}{p.smart ? "✨ " : ""}{p.name} ({fa(p.count)})</button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
        <div className="text-xs font-medium mb-2">ساخت لینک جدید</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام لینک (مثلاً: ماشین، خواب، باشگاه)" className="w-full text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2" />
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {pls.map((p) => (
            <button key={p.id} onClick={() => setPick((s) => toggleIn(s, p.id))} className={`px-3 py-1.5 rounded-md border ${pick.has(p.id) ? "bg-[var(--color-accent)]/20 border-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>{pick.has(p.id) ? "✓ " : ""}{p.smart ? "✨ " : ""}{p.name} ({fa(p.count)})</button>
          ))}
        </div>
        <button onClick={() => void create()} disabled={busy} className="mt-3 text-xs px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white disabled:opacity-50">+ ساخت لینک جدید</button>
      </div>
    </Card>
  );
}
