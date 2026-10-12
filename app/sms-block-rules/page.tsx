"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Badge, PageTitle } from "@/components/Card";
import Section from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { ErrorBox, Field, LoadingBox, Switch, SummaryBar, btnDanger, btnGhost, btnPrimary, cardCls, fa, inputCls } from "@/components/tool-pages/Controls";
import { relTime } from "@/lib/format";

type Rule = {
  id: number;
  exampleBody: string;
  label: string | null;
  enabled: boolean;
  hitCount: number;
  lastHitAt: string | null;
  createdAt: string;
};

export default function SmsBlockRulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [example, setExample] = useState("");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const r = await fetch("/api/sms-block-rules");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { rules: Rule[] };
      setRules(j.rules ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(async () => {
    if (!example.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/sms-block-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exampleBody: example.trim(),
          label: label.trim() || null,
        }),
      });
      if (r.ok) {
        setExample("");
        setLabel("");
        load();
      }
    } finally {
      setCreating(false);
    }
  }, [example, label, load]);

  const update = useCallback(
    async (id: number, patch: Partial<Rule>) => {
      await fetch(`/api/sms-block-rules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: number) => {
      if (!(await confirmDialog("این بلاک حذف بشه؟ پیام‌های شبیه به این از الان به بعد دوباره میان.", { danger: true, confirmLabel: "حذف" }))) return;
      await fetch(`/api/sms-block-rules/${id}`, { method: "DELETE" });
      load();
    },
    [load],
  );

  const on = rules.filter((r) => r.enabled).length;
  const hits = rules.reduce((n, r) => n + r.hitCount, 0);

  return (
    <Shell>
      <div dir="rtl" className="max-w-2xl mx-auto">
        <PageTitle
          title="🚫 قوانین بلاک SMS"
          subtitle="نمونه‌هایی از پیام‌هایی که نمی‌خوای ببینی — هر SMS جدیدی که AI تشخیص بده «از همین مدله» قبل از رسیدن به inbox فیلتر می‌شه."
        />

        <Section icon="➕" title="بلاک جدید" summary="یک نمونه SMS که نمی‌خوای دیگر ببینی" key={!loading && !error && rules.length === 0 ? "empty" : "list"} defaultOpen={!loading && !error && rules.length === 0}>
          <div className="flex flex-col gap-3">
            <Field label="متن نمونه">
              <textarea
                value={example}
                onChange={(e) => setExample(e.target.value)}
                placeholder="متن یه نمونه SMS که نمی‌خوای دیگه ببینی (مثلاً یه تبلیغ آرایشی یا آگهی ملک)"
                rows={4}
                className={inputCls}
              />
            </Field>
            <Field label="برچسب (اختیاری)">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="برچسب اختیاری (مثلاً «تبلیغ آرایشی»)"
                className={inputCls}
              />
            </Field>
            <div className="flex">
              <button onClick={create} disabled={creating || !example.trim()} className={btnPrimary}>
                {creating ? "..." : "اضافه کن"}
              </button>
            </div>
          </div>
        </Section>

        {!loading && !error && rules.length > 0 && (
          <SummaryBar items={[{ text: `${fa(rules.length)} قانون` }, { text: `${fa(on)} روشن`, tone: "ok" }, { text: `${fa(hits.toLocaleString("en-US"))} بار فیلتر شده`, tone: hits > 0 ? "warn" : "neutral" }]} />
        )}

        {loading ? (
          <LoadingBox />
        ) : error ? (
          <ErrorBox text="دریافت قوانین بلاک ناموفق بود." onRetry={load} />
        ) : rules.length === 0 ? (
          <EmptyState
            icon="🚫"
            title="هیچ بلاکی ثبت نشده"
            hint="می‌تونی روی هر SMS که توی notes_inbox میاد دکمه‌ی «🚫 این مدل رو نیار» رو بزنی تا اینجا اضافه بشه."
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {rules.map((r) => (
              <RuleCard key={r.id} r={r} onUpdate={update} onRemove={remove} />
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}

function RuleCard({ r, onUpdate, onRemove }: { r: Rule; onUpdate: (id: number, patch: Partial<Rule>) => void; onRemove: (id: number) => void }) {
  const [full, setFull] = useState(false);
  const rename = async () => {
    const v = await promptDialog("برچسب:", r.label ?? "");
    if (v !== null && v.trim() !== (r.label ?? "")) onUpdate(r.id, { label: v.trim() });
  };
  return (
    <div className={cardCls}>
      <div className="text-sm font-semibold leading-6">{r.label || <span className="font-normal text-[var(--color-text-dim)]">(بدون برچسب)</span>}</div>
      <div className="mt-1.5 flex flex-wrap justify-center items-center gap-1.5">
        {r.enabled ? <Badge tone="success">روشن</Badge> : <Badge tone="neutral">خاموش</Badge>}
        {r.hitCount > 0 && <Badge tone="info">{fa(r.hitCount)} بار</Badge>}
        {r.lastHitAt && <span className="text-xs text-[var(--color-text-dim)]">آخرین: {relTime(r.lastHitAt)}</span>}
      </div>
      {/* the example SMS is quoted text: start-aligned, 3 lines until tapped */}
      <button type="button" onClick={() => setFull((v) => !v)} aria-expanded={full} title="نمایش کامل / کوتاه"
        className="mt-3 block w-full text-start rounded-xl bg-[var(--color-surface-2)] px-3 py-2.5">
        <span dir="auto" className={`block text-xs leading-6 text-[var(--color-text-dim)] whitespace-pre-wrap break-words ${full ? "" : "line-clamp-3"}`}>{r.exampleBody}</span>
      </button>
      <div className="mt-2 text-xs text-[var(--color-text-dim)]">ایجاد: {relTime(r.createdAt)}</div>
      <div className="mt-2 pt-2 border-t border-[var(--color-border)] flex items-center justify-between gap-x-2 flex-wrap">
        <div className="shrink-0"><Switch checked={r.enabled} onChange={(v) => onUpdate(r.id, { enabled: v })} label="فعال" /></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={rename} className={btnGhost}>✏️ برچسب</button>
          <button type="button" onClick={() => onRemove(r.id)} className={btnDanger}>🗑 حذف</button>
        </div>
      </div>
    </div>
  );
}
