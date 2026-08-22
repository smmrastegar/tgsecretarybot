"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";

type DL = {
  id: number; label: string; kind: string;
  botId: number; hosts: string[]; enabled: boolean;
};
const BLANK = { id: 0, label: "", kind: "", botId: "", hosts: "", enabled: true };

export default function LinkDownloadersPage() {
  const [rows, setRows] = useState<DL[]>([]);
  const [form, setForm] = useState<typeof BLANK>({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/link-downloaders");
    if (r.ok) setRows(((await r.json()) as { downloaders: DL[] }).downloaders);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/link-downloaders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, id: form.id || undefined }),
    }).catch(() => null);
    setBusy(false);
    if (r && r.ok) { setForm({ ...BLANK }); setMsg("ذخیره شد ✓"); void load(); }
    else setMsg(((await r?.json().catch(() => ({}))) as { error?: string })?.error ?? "خطا");
  }
  async function remove(id: number) {
    if (!confirm("حذف شود؟ لینک‌های این سرویس دیگر فوروارد نمی‌شوند.")) return;
    await fetch(`/api/link-downloaders?id=${id}`, { method: "DELETE" }).catch(() => {});
    void load();
  }
  async function toggle(d: DL) {
    await fetch("/api/link-downloaders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...d, hosts: d.hosts.join(","), enabled: !d.enabled }),
    }).catch(() => {});
    void load();
  }

  const inp = "w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm";

  return (
    <Shell>
      <PageTitle
        title="🔗 دانلودرهای لینک"
        subtitle="وقتی کسی در چت خصوصی لینکی از این سرویس‌ها بفرستد، لینک برای بات مربوطه ارسال و فایلِ برگشتی به خودش پس داده می‌شود."
      />

      <Card className="mb-4">
        <div className="text-xs font-medium mb-3">{form.id ? "ویرایش" : "سرویس جدید"}</div>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] mb-1">نام</div>
            <input className={inp} value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="مثلاً: YouTube" />
          </div>
          <div>
            <div className="text-[11px] mb-1">آیدی عددی بات دانلودر</div>
            <input className={inp} dir="ltr" value={form.botId}
              onChange={(e) => setForm({ ...form, botId: e.target.value })}
              placeholder="2010101852" />
          </div>
          <div className="md:col-span-2">
            <div className="text-[11px] mb-1">
              دامنه‌ها <span className="text-[var(--color-text-dim)]">(با کاما — زیردامنه‌ها خودکار پوشش داده می‌شوند)</span>
            </div>
            <input className={inp} dir="ltr" value={form.hosts}
              onChange={(e) => setForm({ ...form, hosts: e.target.value })}
              placeholder="instagram.com, instagr.am" />
          </div>
          <label className="flex items-center gap-2 text-[11px] cursor-pointer">
            <input type="checkbox" checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            <span>فعال</span>
          </label>
        </div>
        <div className="flex gap-2 items-center mt-4">
          <button onClick={save} disabled={busy}
            className="text-xs px-4 py-2 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50">
            {busy ? "…" : form.id ? "ذخیره" : "افزودن"}
          </button>
          {form.id > 0 && (
            <button onClick={() => setForm({ ...BLANK })}
              className="text-xs px-3 py-2 rounded-md border border-[var(--color-border)]">انصراف</button>
          )}
          {msg && <span className="text-[11px] text-[var(--color-text-dim)]">{msg}</span>}
        </div>
      </Card>

      {rows.map((d) => (
        <Card key={d.id} className="mb-3">
          <div className="flex justify-between items-start gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {d.label}{" "}
                <span className={`text-[10px] px-2 py-0.5 rounded ${d.enabled ? "bg-emerald-900/40 text-emerald-300" : "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]"}`}>
                  {d.enabled ? "فعال" : "غیرفعال"}
                </span>
              </div>
              <div className="text-[11px] text-[var(--color-text-dim)] mt-1" dir="ltr">
                bot {d.botId} · {d.hosts.join(", ")}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => toggle(d)}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)]">
                {d.enabled ? "غیرفعال کن" : "فعال کن"}
              </button>
              <button onClick={() => setForm({
                  id: d.id, label: d.label, kind: d.kind,
                  botId: String(d.botId), hosts: d.hosts.join(", "), enabled: d.enabled })}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)]">ویرایش</button>
              <button onClick={() => remove(d.id)}
                className="text-xs px-3 py-1.5 rounded-md border border-red-900 text-red-300">حذف</button>
            </div>
          </div>
        </Card>
      ))}
      {rows.length === 0 && (
        <Card><p className="text-sm text-[var(--color-text-dim)]">هنوز سرویسی تعریف نشده.</p></Card>
      )}
    </Shell>
  );
}
