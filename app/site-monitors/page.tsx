"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";

type Monitor = {
  id: number;
  name: string;
  loginUrl: string;
  checkUrl: string;
  username: string | null;
  usernameField: string;
  passwordField: string;
  extraFieldsJson: string | null;
  checkHoursTehran: string;
  skipWeekdays: string;
  enabled: boolean;
  notifyOn: string;
  scrapeMode: string;
  hasPassword: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastSummary: string | null;
};

const WEEKDAYS = [
  ["6", "شنبه"],
  ["0", "یکشنبه"],
  ["1", "دوشنبه"],
  ["2", "سه‌شنبه"],
  ["3", "چهارشنبه"],
  ["4", "پنجشنبه"],
  ["5", "جمعه"],
] as const;

const EMPTY = {
  name: "",
  loginUrl: "",
  checkUrl: "",
  username: "",
  password: "",
  usernameField: "username",
  passwordField: "password",
  extraFieldsJson: "",
  checkHoursTehran: "13,15",
  skipWeekdays: "4,5",
  notifyOn: "change",
  scrapeMode: "http",
};

export default function SiteMonitorsPage() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<typeof EMPTY & { id?: number }>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/site-monitors");
    const j = (await r.json()) as { monitors: Monitor[] };
    setMonitors(j.monitors ?? []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const url = form.id ? `/api/site-monitors/${form.id}` : "/api/site-monitors";
      const method = form.id ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (r.ok) {
        setForm(EMPTY);
        setEditing(false);
        await load();
      } else {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        alert(j.error ?? "خطا در ذخیره");
      }
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (id: number, dryRun: boolean) => {
    setTest((t) => ({ ...t, [id]: "در حال اجرا…" }));
    try {
      const r = await fetch(`/api/site-monitors/${id}/run${dryRun ? "?dryRun=1" : ""}`, {
        method: "POST",
      });
      const j = (await r.json()) as Record<string, unknown>;
      if (dryRun) {
        const a = j.analysis as { hasResult?: boolean; summary?: string } | null;
        setTest((t) => ({
          ...t,
          [id]:
            `وضعیت: ${j.status} ${j.error ? "— " + j.error : ""}\n` +
            `لاگین: ${j.loginInfo ?? "-"}\n` +
            (a ? `AI: ${a.hasResult ? "نتیجه دارد ✅" : "خالی"} — ${a.summary ?? ""}\n` : "") +
            `پیش‌نمایش متن:\n${String(j.textPreview ?? "").slice(0, 600)}`,
        }));
      } else {
        setTest((t) => ({
          ...t,
          [id]: `اجرا شد — وضعیت: ${j.status}، نوتیف: ${j.notified ? "بله" : "خیر"}\n${j.summary ?? ""}`,
        }));
        await load();
      }
    } catch (e) {
      setTest((t) => ({ ...t, [id]: e instanceof Error ? e.message : String(e) }));
    }
  };

  const toggle = async (m: Monitor) => {
    await fetch(`/api/site-monitors/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !m.enabled }),
    });
    await load();
  };

  const del = async (m: Monitor) => {
    if (!confirm(`«${m.name}» حذف بشه؟`)) return;
    await fetch(`/api/site-monitors/${m.id}`, { method: "DELETE" });
    await load();
  };

  const startEdit = (m: Monitor) => {
    setForm({
      id: m.id,
      name: m.name,
      loginUrl: m.loginUrl,
      checkUrl: m.checkUrl,
      username: m.username ?? "",
      password: "",
      usernameField: m.usernameField,
      passwordField: m.passwordField,
      extraFieldsJson: m.extraFieldsJson ?? "",
      checkHoursTehran: m.checkHoursTehran,
      skipWeekdays: m.skipWeekdays,
      notifyOn: m.notifyOn,
      scrapeMode: m.scrapeMode,
    });
    setEditing(true);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const field = (label: string, key: keyof typeof EMPTY, ph = "", type = "text") => (
    <label className="block">
      <span className="text-[10px] text-[var(--color-text-dim)]">{label}</span>
      <input
        type={type}
        dir="ltr"
        value={(form[key] as string) ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder={ph}
        className="w-full text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] mt-0.5"
      />
    </label>
  );

  return (
    <Shell>
      <div dir="rtl">
        <PageTitle
          title="🌐 Site Monitor"
          subtitle="سایت‌های با لاگین رو سر ساعت‌های مشخص (به‌وقت تهران) چک می‌کنه؛ اگه نتیجه‌ای بود با تحلیل AI توی Note Inbox می‌فرسته."
        />

        <Card className="mb-4">
          <div className="text-sm font-medium mb-3">
            {form.id ? `✏️ ویرایش مانیتور #${form.id}` : "➕ مانیتور جدید"}
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            {field("نام", "name", "مثلاً MGH Report")}
            {field("notify_on (change / always / nonempty)", "notifyOn")}
            {field("آدرس صفحه‌ی لاگین", "loginUrl", "https://mgh-report.obsolete.ir/")}
            {field("آدرس صفحه‌ای که باید لود/چک بشه", "checkUrl", "https://mgh-report.obsolete.ir/margin?run=1")}
            {field("یوزرنیم", "username", "Seyed")}
            {field("پسورد (خالی = تغییر نده)", "password", "••••••", "password")}
            {field("نام فیلد یوزرنیم در فرم", "usernameField", "username / user / email")}
            {field("نام فیلد پسورد در فرم", "passwordField", "password / pass")}
            {field("ساعت‌های چک (تهران، با کاما)", "checkHoursTehran", "13,15")}
            {field("فیلدهای اضافی فرم (JSON)", "extraFieldsJson", '{"remember":"1"}')}
          </div>
          <div className="mt-3">
            <div className="text-[10px] text-[var(--color-text-dim)] mb-1">
              روزهایی که چک <b>نشه</b> (تعطیل):
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {WEEKDAYS.map(([num, label]) => {
                const set = new Set(form.skipWeekdays.split(",").map((x) => x.trim()).filter(Boolean));
                const on = set.has(num);
                return (
                  <button
                    key={num}
                    onClick={() => {
                      if (on) set.delete(num);
                      else set.add(num);
                      setForm((f) => ({ ...f, skipWeekdays: [...set].join(",") }));
                    }}
                    className={`text-[11px] px-2 py-1 rounded-md border ${
                      on
                        ? "bg-rose-500/15 border-rose-500/40 text-rose-200"
                        : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-3">
            <div className="text-[10px] text-[var(--color-text-dim)] mb-1">روش چک کردن:</div>
            <div className="flex gap-1.5 flex-wrap">
              {[
                ["http", "🌐 HTTP (سایت ساده، روی Vercel)"],
                ["browser", "🧭 مرورگر (سایت JS، با GitHub Action)"],
              ].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setForm((f) => ({ ...f, scrapeMode: val ?? "http" }))}
                  className={`text-[11px] px-2 py-1 rounded-md border ${
                    form.scrapeMode === val
                      ? "bg-[var(--color-accent)] text-white border-transparent"
                      : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {form.scrapeMode === "browser" && (
              <div className="mt-2 p-2 rounded-md bg-amber-500/5 border border-amber-500/30 text-[10px] text-amber-200 leading-relaxed">
                این سایت با JavaScript کار می‌کنه و کرون Vercel نمی‌تونه رندرش
                کنه. یه GitHub Action (رایگان) با مرورگر واقعی لاگین می‌کنه و
                متن رو می‌فرسته به این اپ. زمان‌بندی توسط همون Action انجام
                می‌شه (سر ۱۳ و ۱۵ تهران، به‌جز پنجشنبه/جمعه). راهنمای ست کردن
                Secretها توی <code>docs/SITE_MONITOR.md</code> هست.
              </div>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={save}
              disabled={saving || !form.name || !form.loginUrl || !form.checkUrl}
              className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-40"
            >
              {saving ? "..." : form.id ? "ذخیره تغییرات" : "ساختن مانیتور"}
            </button>
            {(editing || form.id) && (
              <button
                onClick={() => {
                  setForm(EMPTY);
                  setEditing(false);
                }}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)]"
              >
                انصراف
              </button>
            )}
          </div>
        </Card>

        {loading ? (
          <Card><p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</p></Card>
        ) : monitors.length === 0 ? (
          <Card><p className="text-sm text-[var(--color-text-dim)]">هنوز مانیتوری نساختی.</p></Card>
        ) : (
          <div className="flex flex-col gap-3">
            {monitors.map((m) => (
              <Card key={m.id}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{m.name}</span>
                      {m.enabled ? <Badge tone="success">فعال</Badge> : <Badge tone="neutral">خاموش</Badge>}
                      {m.lastStatus && (
                        <Badge tone={m.lastStatus === "ok" ? "info" : "danger"}>{m.lastStatus}</Badge>
                      )}
                    </div>
                    <div dir="ltr" className="text-[10px] text-[var(--color-text-dim)] mt-1 break-all text-left">
                      {m.checkUrl}
                    </div>
                    <div className="text-[10px] text-[var(--color-text-dim)] mt-1">
                      ساعت‌ها (تهران): {m.checkHoursTehran} · تعطیل:{" "}
                      {m.skipWeekdays.split(",").map((n) => WEEKDAYS.find((w) => w[0] === n.trim())?.[1] ?? n).join("، ")}
                      {" · "}notify: {m.notifyOn}
                    </div>
                    {m.lastRunAt && (
                      <div className="text-[10px] text-[var(--color-text-dim)] mt-1">
                        آخرین اجرا: {new Date(m.lastRunAt).toLocaleString("fa-IR")}
                        {m.lastError ? ` — ❌ ${m.lastError}` : m.lastSummary ? ` — ${m.lastSummary.slice(0, 80)}` : ""}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <button onClick={() => runTest(m.id, true)} className="text-[11px] px-2 py-1 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200">
                      🧪 تست (بدون ارسال)
                    </button>
                    <button onClick={() => runTest(m.id, false)} className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]">
                      ▶️ اجرای کامل
                    </button>
                    <button onClick={() => toggle(m)} className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)]">
                      {m.enabled ? "خاموش" : "روشن"}
                    </button>
                    <button onClick={() => startEdit(m)} className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)]">✏️</button>
                    <button onClick={() => del(m)} className="text-[11px] px-2 py-1 rounded-md border border-rose-500/40 text-rose-200">🗑</button>
                  </div>
                </div>
                {test[m.id] && (
                  <pre dir="ltr" className="mt-2 text-[10px] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md p-2 whitespace-pre-wrap break-words max-h-72 overflow-auto text-left">
                    {test[m.id]}
                  </pre>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
