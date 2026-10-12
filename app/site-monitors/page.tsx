"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import Section, { Pill } from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/Dialogs";

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

const NOTIFY = [
  ["change", "فقط وقتی تغییر کرد"],
  ["nonempty", "هر بار که نتیجه داشت"],
  ["always", "همیشه"],
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

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

const BTN = "min-h-11 px-4 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-[var(--color-accent)] text-white`;
const BTN_PLAIN = `${BTN} border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]`;
const BTN_DANGER = `${BTN} border border-rose-500/40 text-rose-200 hover:bg-rose-500/10`;
const BTN_AMBER = `${BTN} border border-amber-500/40 bg-amber-500/10 text-amber-200`;

// The numbered path from nothing to a working monitor; shown prominently until the first monitor exists.
const SETUP_STEPS = [
  "یک مانیتور جدید بساز: نام، آدرس صفحه‌ی لاگین و آدرس صفحه‌ای که باید چک بشه.",
  "یوزرنیم و پسورد سایت رو بنویس (پسورد فقط ذخیره می‌شه و دوباره نشون داده نمی‌شه).",
  "ساعت‌های چک (به‌وقت تهران) و روزهای تعطیل رو مشخص کن.",
  "«🧪 تست (بدون ارسال)» رو بزن تا ببینی لاگین و خوندن صفحه درست کار می‌کنه؛ بعد مانیتور رو «روشن» بذار.",
];

function SetupSteps() {
  return (
    <ol className="flex flex-col gap-2">
      {SETUP_STEPS.map((t, i) => (
        <li key={i} className="flex items-center gap-3 rounded-xl bg-[var(--color-surface-2)] px-3 py-2.5">
          <span aria-hidden className="grid place-items-center w-8 h-8 rounded-full bg-[var(--color-accent)] text-white text-sm font-semibold shrink-0">{fa(i + 1)}</span>
          <span className="min-w-0 flex-1 text-sm leading-7 text-center">{t}</span>
        </li>
      ))}
    </ol>
  );
}

// A numbered heading that splits the form into the same steps as the guide above.
function StepHead({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 mb-3">
      <div className="flex items-center gap-2">
        <span aria-hidden className="grid place-items-center w-7 h-7 rounded-full bg-[var(--color-accent)] text-white text-sm font-semibold">{fa(n)}</span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      {hint && <p className="text-xs leading-6 text-[var(--color-text-dim)]">{hint}</p>}
    </div>
  );
}

export default function SiteMonitorsPage() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [form, setForm] = useState<typeof EMPTY & { id?: number }>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  // null = automatic (open while there is no monitor yet), otherwise whatever the user chose.
  const [formOpen, setFormOpen] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const r = await fetch("/api/site-monitors");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { monitors: Monitor[] };
      setMonitors(j.monitors ?? []);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setFormErr(null);
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
        setFormOpen(false);
        await load();
      } else {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setFormErr(j.error ?? "خطا در ذخیره");
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
    if (!(await confirmDialog(`«${m.name}» حذف بشه؟`, { danger: true, confirmLabel: "حذف" }))) return;
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
    setFormErr(null);
    setFormOpen(true);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelForm = () => {
    setForm(EMPTY);
    setEditing(false);
    setFormErr(null);
    setFormOpen(false);
  };

  // Form fields are inputs, so they keep LTR text (URLs, usernames); the label above is centred like the card.
  const field = (label: string, key: keyof typeof EMPTY, ph = "", type = "text") => (
    <label className="block">
      <span className="block text-sm text-[var(--color-text-dim)] mb-1.5">{label}</span>
      <input
        type={type}
        dir="ltr"
        value={(form[key] as string) ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder={ph}
        autoComplete="off"
        className="w-full min-h-11 text-sm px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]"
      />
    </label>
  );

  const open = formOpen ?? (!loading && !loadErr && monitors.length === 0);
  const skipSet = new Set(form.skipWeekdays.split(",").map((x) => x.trim()).filter(Boolean));

  return (
    <Shell>
      <PageTitle
        title="🌐 پایش سایت"
        subtitle="سایت‌های با لاگین رو سر ساعت‌های مشخص (به‌وقت تهران) چک می‌کنه؛ اگه نتیجه‌ای بود با تحلیل AI توی Note Inbox می‌فرسته."
      />

      {/* Step by step: the path from an empty page to a working monitor */}
      {monitors.length === 0 && !loading && !loadErr ? (
        <Card className="mb-3">
          <div className="text-sm font-semibold mb-3">🧭 راه‌اندازی در ۴ قدم</div>
          <SetupSteps />
        </Card>
      ) : (
        monitors.length > 0 && (
          <Section icon="🧭" title="راهنمای راه‌اندازی" summary="۴ قدم تا یک مانیتور فعال">
            <SetupSteps />
          </Section>
        )
      )}

      <Section
        icon={form.id ? "✏️" : "➕"}
        title={form.id ? `ویرایش مانیتور #${fa(form.id)}` : "مانیتور جدید"}
        summary={form.id ? form.name : "قدم ۱ تا ۳ را پر کن"}
        open={open}
        onOpenChange={setFormOpen}
      >
        <div className="flex flex-col gap-6">
          <div>
            <StepHead n={1} title="کدام سایت؟" hint="آدرس‌ها را کامل با https:// بنویس." />
            <div className="flex flex-col gap-3">
              {field("نام", "name", "مثلاً MGH Report")}
              {field("آدرس صفحه‌ی لاگین", "loginUrl", "https://mgh-report.obsolete.ir/")}
              {field("آدرس صفحه‌ای که باید لود/چک بشه", "checkUrl", "https://mgh-report.obsolete.ir/margin?run=1")}
            </div>
          </div>

          <div className="pt-5 border-t border-[var(--color-border)]">
            <StepHead n={2} title="اطلاعات ورود" hint="پسورد فقط ذخیره می‌شه و بعداً نشون داده نمی‌شه." />
            <div className="flex flex-col gap-3">
              {field("یوزرنیم", "username", "Seyed")}
              {field("پسورد (خالی = تغییر نده)", "password", "••••••", "password")}
            </div>
            <div className="mt-3">
              <Section icon="🛠" title="تنظیمات پیشرفته‌ی فرم لاگین" summary="اگه لاگین جواب نداد سراغش برو" className="!mb-0">
                <div className="flex flex-col gap-3">
                  {field("نام فیلد یوزرنیم در فرم", "usernameField", "username / user / email")}
                  {field("نام فیلد پسورد در فرم", "passwordField", "password / pass")}
                  {field("فیلدهای اضافی فرم (JSON)", "extraFieldsJson", '{"remember":"1"}')}
                </div>
              </Section>
            </div>
          </div>

          <div className="pt-5 border-t border-[var(--color-border)]">
            <StepHead n={3} title="چه زمانی و چطور؟" />
            {field("ساعت‌های چک (تهران، با کاما)", "checkHoursTehran", "13,15")}

            <div className="mt-4">
              <div className="text-sm text-[var(--color-text-dim)] mb-2">
                روزهایی که چک <b>نشه</b> (تعطیل):
              </div>
              <div className="flex gap-2 flex-wrap justify-center">
                {WEEKDAYS.map(([num, label]) => {
                  const on = skipSet.has(num);
                  return (
                    <button
                      key={num}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const next = new Set(skipSet);
                        if (on) next.delete(num);
                        else next.add(num);
                        setForm((f) => ({ ...f, skipWeekdays: [...next].join(",") }));
                      }}
                      className={`min-h-11 px-3.5 rounded-xl border text-sm ${
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

            <div className="mt-4">
              <div className="text-sm text-[var(--color-text-dim)] mb-2">روش چک کردن:</div>
              <div className="grid grid-cols-1 gap-2">
                {[
                  ["http", "🌐 HTTP (سایت ساده، روی Vercel)"],
                  ["browser", "🧭 مرورگر (سایت JS، با GitHub Action)"],
                ].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    aria-pressed={form.scrapeMode === val}
                    onClick={() => setForm((f) => ({ ...f, scrapeMode: val ?? "http" }))}
                    className={`min-h-11 px-3 rounded-xl border text-sm ${
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
                <div className="mt-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/30 text-xs text-amber-200 leading-7">
                  این سایت با JavaScript کار می‌کنه و کرون Vercel نمی‌تونه رندرش
                  کنه. یه GitHub Action (رایگان) با مرورگر واقعی لاگین می‌کنه و
                  متن رو می‌فرسته به این اپ. زمان‌بندی توسط همون Action انجام
                  می‌شه (سر ۱۳ و ۱۵ تهران، به‌جز پنجشنبه/جمعه). راهنمای ست کردن
                  Secretها توی <code dir="ltr">docs/SITE_MONITOR.md</code> هست.
                </div>
              )}
            </div>

            <div className="mt-4">
              <div className="text-sm text-[var(--color-text-dim)] mb-2">کی خبر بده؟ (notify_on)</div>
              <div className="grid grid-cols-1 gap-2 mb-2">
                {NOTIFY.map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    aria-pressed={form.notifyOn === val}
                    onClick={() => setForm((f) => ({ ...f, notifyOn: val }))}
                    className={`min-h-11 px-3 rounded-xl border text-sm ${
                      form.notifyOn === val
                        ? "bg-[var(--color-accent)] text-white border-transparent"
                        : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                    }`}
                  >
                    {label} <span dir="ltr" className="opacity-70">({val})</span>
                  </button>
                ))}
              </div>
              {field("notify_on (change / always / nonempty)", "notifyOn")}
            </div>
          </div>

          {formErr && (
            <div className="rounded-xl border border-red-800 bg-red-900/20 px-3 py-2.5 text-sm text-red-300 leading-6">{formErr}</div>
          )}

          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving || !form.name || !form.loginUrl || !form.checkUrl}
              className={BTN_PRIMARY}
            >
              {saving ? "..." : form.id ? "ذخیره تغییرات" : "ساختن مانیتور"}
            </button>
            {(editing || form.id) && (
              <button onClick={cancelForm} className={BTN_PLAIN}>
                انصراف
              </button>
            )}
          </div>
        </div>
      </Section>

      {loadErr ? (
        <Card>
          <p className="text-sm text-red-300">خطا در بارگذاری مانیتورها: {loadErr}</p>
          <div className="mt-3 flex">
            <button onClick={() => void load()} className={BTN_PRIMARY}>تلاش دوباره</button>
          </div>
        </Card>
      ) : loading && monitors.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</p>
        </Card>
      ) : monitors.length === 0 ? (
        <EmptyState
          icon="🌐"
          title="هنوز مانیتوری نساختی."
          hint="فرم «مانیتور جدید» بالا را پر کن؛ ۴ قدم راهنما همین بالاست."
        />
      ) : (
        <div className="flex flex-col gap-3 mt-4">
          {monitors.map((m) => (
            <Card key={m.id}>
              <div dir="auto" className="text-base font-semibold leading-7">{m.name}</div>
              <div className="mt-2 flex items-center justify-center gap-1.5 flex-wrap">
                {m.enabled ? <Pill tone="ok">فعال</Pill> : <Pill>خاموش</Pill>}
                {m.lastStatus && (
                  <Pill tone={m.lastStatus === "ok" ? "ok" : "bad"}>{m.lastStatus}</Pill>
                )}
                <Pill>{m.scrapeMode === "browser" ? "🧭 مرورگر" : "🌐 HTTP"}</Pill>
              </div>
              <div dir="ltr" className="text-xs text-[var(--color-text-dim)] mt-3 break-all leading-5">
                {m.checkUrl}
              </div>
              <div className="text-xs text-[var(--color-text-dim)] mt-2 leading-6">
                ساعت‌ها (تهران): <span dir="ltr">{m.checkHoursTehran}</span> · تعطیل:{" "}
                {m.skipWeekdays.split(",").map((n) => WEEKDAYS.find((w) => w[0] === n.trim())?.[1] ?? n).join("، ")}
                {" · "}notify: {m.notifyOn}
              </div>
              {m.lastRunAt ? (
                <div className="text-xs text-[var(--color-text-dim)] mt-2 leading-6">
                  آخرین اجرا: {new Date(m.lastRunAt).toLocaleString("fa-IR")}
                  {m.lastError ? ` — ❌ ${m.lastError}` : m.lastSummary ? ` — ${m.lastSummary.slice(0, 80)}` : ""}
                </div>
              ) : (
                <div className="mt-3 rounded-xl bg-amber-500/5 border border-amber-500/30 px-3 py-2 text-xs text-amber-200 leading-6">
                  هنوز اجرا نشده — اول «🧪 تست» رو بزن تا مطمئن بشی لاگین کار می‌کنه.
                </div>
              )}

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button onClick={() => void runTest(m.id, true)} className={`${BTN_AMBER} col-span-2`}>
                  🧪 تست (بدون ارسال)
                </button>
                <button onClick={() => void runTest(m.id, false)} className={BTN_PLAIN}>
                  ▶️ اجرای کامل
                </button>
                <button onClick={() => void toggle(m)} className={BTN_PLAIN}>
                  {m.enabled ? "⏸ خاموش" : "✅ روشن"}
                </button>
                <button onClick={() => startEdit(m)} className={BTN_PLAIN}>
                  ✏️ ویرایش
                </button>
                <button onClick={() => void del(m)} className={BTN_DANGER}>
                  🗑 حذف
                </button>
              </div>
              {test[m.id] && (
                <pre dir="ltr" className="mt-3 text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl p-3 whitespace-pre-wrap break-words max-h-72 overflow-auto text-start">
                  {test[m.id]}
                </pre>
              )}
            </Card>
          ))}
        </div>
      )}
    </Shell>
  );
}
