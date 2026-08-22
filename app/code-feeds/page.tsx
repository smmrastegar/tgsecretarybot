"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";

type Feed = {
  id: number;
  token: string;
  label: string;
  chatId: number;
  windowSeconds: number;
  format: string;
  codesOnly: boolean;
  allowedIps: string[];
  enabled: boolean;
  lastAccessAt: string | null;
  lastAccessIp: string | null;
};

const BLANK = {
  id: 0,
  label: "",
  chatId: "",
  windowSeconds: 300,
  format: "json",
  codesOnly: true,
  allowedIps: "",
  enabled: true,
};

export default function CodeFeedsPage() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [form, setForm] = useState<typeof BLANK>({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/code-feeds");
    if (r.ok) setFeeds(((await r.json()) as { feeds: Feed[] }).feeds);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/code-feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, id: form.id || undefined }),
    }).catch(() => null);
    setBusy(false);
    if (r && r.ok) { setForm({ ...BLANK }); setMsg("ذخیره شد ✓"); void load(); }
    else setMsg("خطا در ذخیره");
  }
  async function remove(id: number) {
    if (!confirm("این فید حذف شود؟ لینکش از کار می‌افتد.")) return;
    await fetch(`/api/code-feeds?id=${id}`, { method: "DELETE" }).catch(() => {});
    void load();
  }
  async function toggle(f: Feed) {
    await fetch("/api/code-feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: f.id, label: f.label, chatId: f.chatId,
        windowSeconds: f.windowSeconds, format: f.format,
        codesOnly: f.codesOnly, allowedIps: f.allowedIps.join(","),
        enabled: !f.enabled,
      }),
    }).catch(() => {});
    void load();
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const inp = "w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm";

  return (
    <Shell>
      <PageTitle
        title="🔑 فیدهای کد"
        subtitle="لینک توکن‌دار که فقط پیام‌های دارای کد یک کانال را، آن هم فقط داخل یک بازه‌ی زمانی کوتاه، نشان می‌دهد."
      />

      <Card className="mb-4">
        <div className="text-xs font-medium mb-3">
          {form.id ? "ویرایش فید" : "فید جدید"}
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] mb-1">نام</div>
            <input className={inp} value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="مثلاً: کدهای SMS" />
          </div>
          <div>
            <div className="text-[11px] mb-1">chat_id کانال</div>
            <input className={inp} dir="ltr" value={form.chatId}
              onChange={(e) => setForm({ ...form, chatId: e.target.value })}
              placeholder="-1001213128961" />
          </div>
          <div>
            <div className="text-[11px] mb-1">بازه‌ی زمانی (ثانیه)</div>
            <input className={inp} dir="ltr" type="number" value={form.windowSeconds}
              onChange={(e) => setForm({ ...form, windowSeconds: Number(e.target.value) })} />
            <div className="text-[10px] text-[var(--color-text-dim)] mt-1">
              ۳۰۰ = پنج دقیقه‌ی اخیر
            </div>
          </div>
          <div>
            <div className="text-[11px] mb-1">فرمت خروجی</div>
            <select className={inp} value={form.format}
              onChange={(e) => setForm({ ...form, format: e.target.value })}>
              <option value="json">JSON (کد + متن + زمان)</option>
              <option value="text">متن ساده</option>
              <option value="codes">فقط کدها (هر خط یکی)</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <div className="text-[11px] mb-1">
              IPهای مجاز <span className="text-[var(--color-text-dim)]">(با کاما — خالی = همه)</span>
            </div>
            <input className={inp} dir="ltr" value={form.allowedIps}
              onChange={(e) => setForm({ ...form, allowedIps: e.target.value })}
              placeholder="1.2.3.4, 5.6.7.0/24" />
          </div>
          <label className="flex items-center gap-2 text-[11px] cursor-pointer">
            <input type="checkbox" checked={form.codesOnly}
              onChange={(e) => setForm({ ...form, codesOnly: e.target.checked })} />
            <span>فقط پیام‌هایی که کد دارند</span>
          </label>
          <label className="flex items-center gap-2 text-[11px] cursor-pointer">
            <input type="checkbox" checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            <span>فعال</span>
          </label>
        </div>
        <div className="flex gap-2 items-center mt-4">
          <button onClick={save} disabled={busy}
            className="text-xs px-4 py-2 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50">
            {busy ? "…" : form.id ? "ذخیره" : "ساختن فید"}
          </button>
          {form.id > 0 && (
            <button onClick={() => setForm({ ...BLANK })}
              className="text-xs px-3 py-2 rounded-md border border-[var(--color-border)]">انصراف</button>
          )}
          {msg && <span className="text-[11px] text-[var(--color-text-dim)]">{msg}</span>}
        </div>
      </Card>

      {feeds.map((f) => (
        <Card key={f.id} className="mb-3">
          <div className="flex justify-between items-start gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {f.label}{" "}
                <span className={`text-[10px] px-2 py-0.5 rounded ${f.enabled ? "bg-emerald-900/40 text-emerald-300" : "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]"}`}>
                  {f.enabled ? "فعال" : "غیرفعال"}
                </span>
              </div>
              <div className="text-[11px] text-[var(--color-text-dim)] mt-1" dir="ltr">
                chat {f.chatId} · {f.windowSeconds}s · {f.format}
                {f.codesOnly ? " · codes-only" : ""}
                {f.allowedIps.length ? ` · IP: ${f.allowedIps.join(", ")}` : " · any IP"}
              </div>
              <code className="block mt-2 text-[10px] break-all bg-[var(--color-surface-2)] p-2 rounded" dir="ltr">
                {origin}/api/feeds/{f.token}
              </code>
              {f.lastAccessAt && (
                <div className="text-[10px] text-[var(--color-text-dim)] mt-1" dir="ltr">
                  last access: {new Date(f.lastAccessAt).toLocaleString("fa-IR")}
                  {f.lastAccessIp ? ` — ${f.lastAccessIp}` : ""}
                </div>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => toggle(f)}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)]">
                {f.enabled ? "غیرفعال کن" : "فعال کن"}
              </button>
              <button onClick={() => setForm({
                  id: f.id, label: f.label, chatId: String(f.chatId),
                  windowSeconds: f.windowSeconds, format: f.format,
                  codesOnly: f.codesOnly, allowedIps: f.allowedIps.join(", "),
                  enabled: f.enabled,
                })}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)]">ویرایش</button>
              <button onClick={() => remove(f.id)}
                className="text-xs px-3 py-1.5 rounded-md border border-red-900 text-red-300">حذف</button>
            </div>
          </div>
        </Card>
      ))}
      {feeds.length === 0 && (
        <Card><p className="text-sm text-[var(--color-text-dim)]">هنوز فیدی ساخته نشده.</p></Card>
      )}
    </Shell>
  );
}
