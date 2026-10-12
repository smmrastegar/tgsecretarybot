"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Badge, PageTitle } from "@/components/Card";
import Section from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/Dialogs";
import { CopyBtn, ErrorBox, Field, LoadingBox, Switch, SummaryBar, UrlBox, btnDanger, btnGhost, btnPrimary, cardCls, fa, inputCls } from "@/components/tool-pages/Controls";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  // The form lives above the list, so clicking "ویرایش" on a row far
  // down the page used to change something the user couldn't see.
  const formRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const r = await fetch("/api/code-feeds");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setFeeds(((await r.json()) as { feeds: Feed[] }).feeds);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  function focusForm() {
    setFormOpen(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }
  function startNew() {
    setForm({ ...BLANK });
    setMsg(null);
    focusForm();
  }
  function startEdit(f: Feed) {
    setForm({
      id: f.id,
      label: f.label,
      chatId: String(f.chatId),
      windowSeconds: f.windowSeconds,
      format: f.format,
      codesOnly: f.codesOnly,
      allowedIps: f.allowedIps.join(", "),
      enabled: f.enabled,
    });
    setMsg(null);
    focusForm();
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const editing = form.id > 0;
    const r = await fetch("/api/code-feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, id: form.id || undefined }),
    }).catch(() => null);
    setBusy(false);
    if (r && r.ok) {
      setForm({ ...BLANK });
      setFormOpen(false);
      setMsg(editing ? "تغییرات ذخیره شد ✓" : "فید ساخته شد ✓");
      void load();
    } else setMsg("خطا در ذخیره");
  }
  // The token IS the credential for this URL, so it has to be burnable
  // without rebuilding the feed. The old link dies the moment this runs.
  async function rotate(f: Feed) {
    if (
      !(await confirmDialog(
        `توکنِ «${f.label}» عوض شود؟\n\nلینک فعلی بلافاصله از کار می‌افتد و هرجا استفاده شده باید با لینک جدید جایگزین شود.`,
        { danger: true, confirmLabel: "توکن جدید" },
      ))
    )
      return;
    const r = await fetch("/api/code-feeds", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: f.id, action: "rotate_token" }),
    }).catch(() => null);
    setMsg(r && r.ok ? "توکن عوض شد — لینک جدید را کپی کن ✓" : "خطا در تغییر توکن");
    void load();
  }
  async function remove(id: number) {
    if (!(await confirmDialog("این فید حذف شود؟ لینکش از کار می‌افتد.", { danger: true, confirmLabel: "حذف" }))) return;
    await fetch(`/api/code-feeds?id=${id}`, { method: "DELETE" }).catch(() => {});
    if (form.id === id) setForm({ ...BLANK });
    void load();
  }
  async function toggle(f: Feed) {
    await fetch("/api/code-feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: f.id,
        label: f.label,
        chatId: f.chatId,
        windowSeconds: f.windowSeconds,
        format: f.format,
        codesOnly: f.codesOnly,
        allowedIps: f.allowedIps.join(","),
        enabled: !f.enabled,
      }),
    }).catch(() => {});
    void load();
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const editing = form.id > 0;
  const editingFeed = editing ? feeds.find((f) => f.id === form.id) : undefined;
  const open = feeds.filter((f) => f.enabled && f.allowedIps.length === 0).length;

  return (
    <Shell>
      <div className="max-w-2xl mx-auto">
        <PageTitle
          title="🔑 فیدهای کد"
          subtitle="لینک توکن‌دار که فقط پیام‌های دارای کد یک کانال را، آن هم فقط داخل یک بازه‌ی زمانی کوتاه، نشان می‌دهد."
          actions={<button onClick={startNew} className={btnPrimary}>➕ فید جدید</button>}
        />

        <div ref={formRef}>
          <Section
            icon={editing ? "✏️" : "➕"}
            title={editing ? `ویرایشِ ${editingFeed?.label || form.label || `#${form.id}`}` : "ساختن فید جدید"}
            summary="نام، کانال، بازه‌ی زمانی و IPهای مجاز"
            open={formOpen || (!loading && !error && feeds.length === 0)}
            onOpenChange={setFormOpen}
            className={editing ? "!border-[var(--color-accent)]" : ""}
          >
            <div className="flex flex-col gap-3">
              <Field label="نام">
                <input className={inputCls} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="مثلاً: کدهای SMS" />
              </Field>
              <Field label="chat_id کانال">
                <input className={inputCls} dir="ltr" value={form.chatId} onChange={(e) => setForm({ ...form, chatId: e.target.value })} placeholder="-1001213128961" />
              </Field>
              <Field label="بازه‌ی زمانی (ثانیه)" hint="۳۰۰ = پنج دقیقه‌ی اخیر">
                <input className={inputCls} dir="ltr" type="number" inputMode="numeric" value={form.windowSeconds} onChange={(e) => setForm({ ...form, windowSeconds: Number(e.target.value) })} />
              </Field>
              <Field label="فرمت خروجی">
                <select className={inputCls} value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
                  <option value="html">HTML (صفحه‌ی آماده با دکمه‌ی کپی)</option>
                  <option value="json">JSON (کد + متن + زمان)</option>
                  <option value="text">متن ساده</option>
                  <option value="codes">فقط کدها (هر خط یکی)</option>
                </select>
              </Field>
              <Field label="IPهای مجاز (با کاما — خالی = همه)"
                hint={!form.allowedIps.trim() ? <span className="text-amber-400/90">خالی یعنی هرکسی که لینک را داشته باشد کدها را می‌بیند.</span> : undefined}>
                <input className={inputCls} dir="ltr" value={form.allowedIps} onChange={(e) => setForm({ ...form, allowedIps: e.target.value })} placeholder="1.2.3.4, 5.6.7.0/24" />
              </Field>
              <div>
                <Switch checked={form.codesOnly} onChange={(v) => setForm({ ...form, codesOnly: v })} label="فقط پیام‌هایی که کد دارند" />
                <Switch checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="فعال" />
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={save} disabled={busy} className={btnPrimary}>
                  {busy ? "…" : editing ? "ذخیره‌ی تغییرات" : "ساختن فید"}
                </button>
                {editing && (
                  <button onClick={startNew} className={btnGhost}>در عوض، فید جدید بساز</button>
                )}
                {editing && (
                  <button onClick={() => { setForm({ ...BLANK }); setMsg(null); setFormOpen(false); }} className={btnGhost}>انصراف</button>
                )}
              </div>
            </div>
          </Section>
        </div>

        {msg && <p role="status" className="mb-3 text-center text-sm text-[var(--color-text-dim)]">{msg}</p>}

        {!loading && !error && feeds.length > 0 && (
          <SummaryBar items={[{ text: `${fa(feeds.length)} فید` }, { text: `${fa(feeds.filter((f) => f.enabled).length)} فعال`, tone: "ok" }, ...(open > 0 ? [{ text: `${fa(open)} بدون محدودیت IP`, tone: "warn" as const }] : [])]} />
        )}

        {loading ? (
          <LoadingBox />
        ) : error ? (
          <ErrorBox text="دریافت فیدها ناموفق بود." onRetry={load} />
        ) : feeds.length === 0 ? (
          <EmptyState icon="🔑" title="هنوز فیدی ساخته نشده" hint="فرم بالا را پر کن و «ساختن فید» را بزن."
            action={<button onClick={startNew} className={btnPrimary}>➕ فید جدید</button>} />
        ) : (
          <div className="flex flex-col gap-3">
            {feeds.map((f) => (
              <FeedCard key={f.id} f={f} url={`${origin}/api/feeds/${f.token}`} isEditing={form.id === f.id}
                onEdit={() => startEdit(f)} onToggle={() => toggle(f)} onRotate={() => rotate(f)} onRemove={() => remove(f.id)} />
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}

function FeedCard({ f, url, isEditing, onEdit, onToggle, onRotate, onRemove }: {
  f: Feed; url: string; isEditing: boolean; onEdit: () => void; onToggle: () => void; onRotate: () => void; onRemove: () => void;
}) {
  const [more, setMore] = useState(false);
  return (
    <div className={`${cardCls} ${isEditing ? "!border-[var(--color-accent)]" : ""}`}>
      <div className="text-sm font-semibold leading-6">{f.label}</div>
      <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
        {f.enabled ? <Badge tone="success">فعال</Badge> : <Badge tone="neutral">غیرفعال</Badge>}
        {isEditing && <Badge tone="info">در حال ویرایش</Badge>}
      </div>
      <div className="mt-2 text-xs leading-6 text-[var(--color-text-dim)]" dir="ltr">
        chat {f.chatId} · {f.windowSeconds}s · {f.format}
        {f.codesOnly ? " · codes-only" : ""}
        {f.allowedIps.length ? ` · IP: ${f.allowedIps.join(", ")}` : null}
      </div>
      {f.allowedIps.length === 0 && f.enabled && (
        <div className="mt-1 text-xs leading-5 text-amber-400">
          ⚠️ بدون محدودیت IP — هر کسی که این لینک را داشته باشد کدها را می‌بیند.
        </div>
      )}

      <div className="mt-3"><UrlBox value={url} /></div>
      <div className="mt-2 flex flex-wrap gap-2">
        <CopyBtn value={url} label="کپی لینک" primary />
        <a href={url} target="_blank" rel="noreferrer" className={`${btnGhost} inline-flex items-center`}>باز کردن ↗</a>
        <button onClick={() => setMore((v) => !v)} aria-expanded={more} className={btnGhost}>{more ? "بستن" : "⋯ بیشتر"}</button>
      </div>

      {f.lastAccessAt && (
        <div className="mt-2 text-xs text-[var(--color-text-dim)]" dir="ltr">
          last access: {new Date(f.lastAccessAt).toLocaleString("fa-IR")}
          {f.lastAccessIp ? ` — ${f.lastAccessIp}` : ""}
        </div>
      )}

      {more && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex flex-wrap gap-2">
          <button onClick={onEdit} className={btnGhost}>✏️ ویرایش</button>
          <button onClick={onToggle} className={btnGhost}>{f.enabled ? "غیرفعال کن" : "فعال کن"}</button>
          <CopyBtn value={f.token} label="کپی توکن" />
          <button onClick={onRotate} title="توکن جدید بساز — لینک قبلی از کار می‌افتد" className="min-h-10 px-4 rounded-xl border border-amber-700/60 text-amber-300 text-sm">🔄 توکن جدید</button>
          <button onClick={onRemove} className={btnDanger}>حذف</button>
        </div>
      )}
    </div>
  );
}
