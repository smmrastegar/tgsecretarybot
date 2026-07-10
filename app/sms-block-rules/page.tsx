"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Badge, Card, PageTitle } from "@/components/Card";
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
  const [example, setExample] = useState("");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/sms-block-rules");
      if (r.ok) {
        const j = (await r.json()) as { rules: Rule[] };
        setRules(j.rules ?? []);
      }
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
      if (!confirm("این بلاک حذف بشه؟ پیام‌های شبیه به این از الان به بعد دوباره میان.")) return;
      await fetch(`/api/sms-block-rules/${id}`, { method: "DELETE" });
      load();
    },
    [load],
  );

  return (
    <Shell>
      <div dir="rtl">
        <PageTitle
          title="🚫 قوانین بلاک SMS"
          subtitle="نمونه‌هایی از پیام‌هایی که نمی‌خوای ببینی — هر SMS جدیدی که AI تشخیص بده «از همین مدله» قبل از رسیدن به inbox فیلتر می‌شه."
        />

        <Card className="mb-4">
          <div className="text-xs font-medium mb-2">+ بلاک جدید</div>
          <div className="flex flex-col gap-2">
            <textarea
              value={example}
              onChange={(e) => setExample(e.target.value)}
              placeholder="متن یه نمونه SMS که نمی‌خوای دیگه ببینی (مثلاً یه تبلیغ آرایشی یا آگهی ملک)"
              rows={3}
              className="text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-1.5"
            />
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="برچسب اختیاری (مثلاً «تبلیغ آرایشی»)"
              className="text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-1.5"
            />
            <div className="flex justify-end">
              <button
                onClick={create}
                disabled={creating || !example.trim()}
                className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
              >
                {creating ? "..." : "اضافه کن"}
              </button>
            </div>
          </div>
        </Card>

        {loading ? (
          <Card>در حال بارگذاری…</Card>
        ) : rules.length === 0 ? (
          <Card>
            <p className="text-sm text-[var(--color-text-dim)]">
              هیچ بلاکی ثبت نشده. می‌تونی روی هر SMS که توی notes_inbox میاد
              دکمه‌ی «🚫 این مدل رو نیار» رو بزنی تا اینجا اضافه بشه.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {rules.map((r) => (
              <Card key={r.id} className="!p-3">
                <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      defaultValue={r.label ?? ""}
                      placeholder="(بدون برچسب)"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (r.label ?? "")) update(r.id, { label: v });
                      }}
                      className="text-sm font-medium bg-transparent border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none px-1 py-0.5"
                    />
                    {r.enabled ? (
                      <Badge tone="success">روشن</Badge>
                    ) : (
                      <Badge tone="neutral">خاموش</Badge>
                    )}
                    {r.hitCount > 0 && (
                      <Badge tone="info">{r.hitCount} بار</Badge>
                    )}
                    {r.lastHitAt && (
                      <span className="text-[10px] text-[var(--color-text-dim)]">
                        آخرین: {relTime(r.lastHitAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) =>
                          update(r.id, { enabled: e.target.checked })
                        }
                      />
                      فعال
                    </label>
                    <button
                      onClick={() => remove(r.id)}
                      className="text-[10px] text-red-300 hover:text-red-200 px-1.5 py-0.5 rounded"
                    >
                      🗑
                    </button>
                  </div>
                </div>
                <pre
                  dir="auto"
                  className="text-[11px] text-[var(--color-text-dim)] whitespace-pre-wrap break-words bg-[var(--color-surface-2)] rounded-md p-2 max-h-32 overflow-auto"
                >
                  {r.exampleBody}
                </pre>
                <div className="text-[10px] text-[var(--color-text-dim)] mt-1">
                  ایجاد: {relTime(r.createdAt)}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
