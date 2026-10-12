"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Badge, PageTitle } from "@/components/Card";
import Section from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/Dialogs";
import { ErrorBox, Field, LoadingBox, Switch, SummaryBar, btnDanger, btnGhost, btnPrimary, cardCls, fa, inputCls } from "@/components/tool-pages/Controls";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const formRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const r = await fetch("/api/link-downloaders");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setRows(((await r.json()) as { downloaders: DL[] }).downloaders);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/link-downloaders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, id: form.id || undefined }),
    }).catch(() => null);
    setBusy(false);
    if (r && r.ok) { setForm({ ...BLANK }); setMsg("ذخیره شد ✓"); setFormOpen(false); void load(); }
    else setMsg(((await r?.json().catch(() => ({}))) as { error?: string })?.error ?? "خطا");
  }
  async function remove(id: number) {
    if (!(await confirmDialog("حذف شود؟ لینک‌های این سرویس دیگر فوروارد نمی‌شوند.", { danger: true, confirmLabel: "حذف" }))) return;
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
  function startEdit(d: DL) {
    setForm({ id: d.id, label: d.label, kind: d.kind, botId: String(d.botId), hosts: d.hosts.join(", "), enabled: d.enabled });
    setMsg(null);
    setFormOpen(true);
    // the form sits above the list: bring it into view so the edit is visible
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  const active = rows.filter((d) => d.enabled).length;

  return (
    <Shell>
      <div className="max-w-2xl mx-auto">
        <PageTitle
          title="🔗 دانلودرهای لینک"
          subtitle="وقتی کسی در چت خصوصی لینکی از این سرویس‌ها بفرستد، لینک برای بات مربوطه ارسال و فایلِ برگشتی به خودش پس داده می‌شود."
        />

        <div ref={formRef}>
          <Section icon={form.id ? "✏️" : "➕"} title={form.id ? "ویرایش" : "سرویس جدید"} summary={form.id ? form.label : "نام، آیدی بات و دامنه‌ها"}
            open={formOpen || (!loading && !error && rows.length === 0)} onOpenChange={setFormOpen}>
            <div className="flex flex-col gap-3">
              <Field label="نام">
                <input className={inputCls} value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="مثلاً: YouTube" />
              </Field>
              <Field label="آیدی عددی بات دانلودر">
                <input className={inputCls} dir="ltr" inputMode="numeric" value={form.botId}
                  onChange={(e) => setForm({ ...form, botId: e.target.value })}
                  placeholder="2010101852" />
              </Field>
              <Field label="دامنه‌ها" hint="با کاما — زیردامنه‌ها خودکار پوشش داده می‌شوند">
                <input className={inputCls} dir="ltr" value={form.hosts}
                  onChange={(e) => setForm({ ...form, hosts: e.target.value })}
                  placeholder="instagram.com, instagr.am" />
              </Field>
              <Switch checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="فعال" />
              <div className="flex flex-wrap gap-2">
                <button onClick={save} disabled={busy} className={btnPrimary}>
                  {busy ? "…" : form.id ? "ذخیره" : "افزودن"}
                </button>
                {form.id > 0 && (
                  <button onClick={() => { setForm({ ...BLANK }); setMsg(null); }} className={btnGhost}>انصراف</button>
                )}
              </div>
            </div>
          </Section>
        </div>

        {msg && <p role="status" className="mb-3 text-center text-sm text-[var(--color-text-dim)]">{msg}</p>}

        {!loading && !error && rows.length > 0 && (
          <SummaryBar items={[{ text: `${fa(rows.length)} سرویس` }, { text: `${fa(active)} فعال`, tone: "ok" }]} />
        )}

        {loading ? (
          <LoadingBox />
        ) : error ? (
          <ErrorBox text="دریافت فهرست دانلودرها ناموفق بود." onRetry={load} />
        ) : rows.length === 0 ? (
          <EmptyState icon="🔗" title="هنوز سرویسی تعریف نشده" hint="فرم بالا را پر کن و «افزودن» را بزن." />
        ) : (
          <div className="flex flex-col gap-2.5">
            {rows.map((d) => (
              <div key={d.id} className={`${cardCls} ${form.id === d.id ? "!border-[var(--color-accent)]" : ""}`}>
                <div className="text-sm font-semibold leading-6">{d.label}</div>
                <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
                  {d.enabled ? <Badge tone="success">فعال</Badge> : <Badge tone="neutral">غیرفعال</Badge>}
                  {form.id === d.id && <Badge tone="info">در حال ویرایش</Badge>}
                </div>
                <div dir="ltr" className="mt-2 text-xs text-[var(--color-text-dim)]">bot {d.botId}</div>
                <div dir="ltr" className="mt-2 flex flex-wrap justify-center gap-1.5">
                  {d.hosts.map((h) => <span key={h} className="px-2.5 py-1 rounded-full text-xs bg-[var(--color-surface-2)] break-all">{h}</span>)}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => startEdit(d)} className={btnGhost}>ویرایش</button>
                  <button onClick={() => toggle(d)} className={btnGhost}>{d.enabled ? "غیرفعال کن" : "فعال کن"}</button>
                  <button onClick={() => remove(d.id)} className={btnDanger}>حذف</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
