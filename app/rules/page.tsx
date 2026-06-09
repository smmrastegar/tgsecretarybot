"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";

import { relTime, truncate } from "@/lib/format";

type Rule = {
  id: number;
  name: string;
  description: string;
  forwardFormat: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  recipientCount: number;
};
type RecentMatch = {
  id: number;
  ruleId: number;
  ruleName: string;
  messageLogId: number;
  formattedText: string | null;
  forwardedTo: number[];
  matchedAt: string;
  messageText: string;
  senderName: string;
  chatId: number;
};

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [recent, setRecent] = useState<RecentMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [format, setFormat] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/rules"),
        fetch("/api/rules/recent-matches?limit=20"),
      ]);
      if (r1.ok) {
        const j = (await r1.json()) as { rules: Rule[] };
        setRules(j.rules ?? []);
      }
      if (r2.ok) {
        const j = (await r2.json()) as { matches: RecentMatch[] };
        setRecent(j.matches ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(async () => {
    if (!name.trim() || !desc.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: desc,
          forwardFormat: format || undefined,
        }),
      });
      if (r.ok) {
        setName("");
        setDesc("");
        setFormat("");
        setShowCreate(false);
        load();
      }
    } finally {
      setCreating(false);
    }
  }, [name, desc, format, load]);

  const toggle = useCallback(
    async (id: number, enabled: boolean) => {
      await fetch(`/api/rules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      load();
    },
    [load],
  );

  return (
    <Shell>
      <PageTitle
        title="📐 Rules"
        subtitle="قانون‌های تشخیص پیام به‌علاوه‌ی فوروارد خودکار. هر قانون رو با یه متن طبیعی توصیف کن و گیرنده‌ها رو ست کن."
        actions={
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90"
          >
            {showCreate ? "بستن" : "+ rule جدید"}
          </button>
        }
      />

      {showCreate && (
        <Card className="mb-4">
          <div className="text-xs font-medium mb-2">ساخت rule جدید</div>
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="اسم rule (مثلاً «کدهای OTP»)"
              className="text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2"
            />
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="توصیف: چه پیام‌هایی باید match بشن؟ (مثلاً: «پیام‌هایی که شامل یک کد تایید/OTP/verification هستن، معمولاً ۴ تا ۸ رقمی»)"
              rows={3}
              className="text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2"
            />
            <textarea
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              placeholder="(اختیاری) format فوروارد — مثلاً «فقط عدد کد رو با emoji 🔑 و علامت bold بفرست» — خالی = پیام اصلی فوروارد می‌شه"
              rows={2}
              className="text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)]"
              >
                انصراف
              </button>
              <button
                onClick={create}
                disabled={creating || !name.trim() || !desc.trim()}
                className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
              >
                {creating ? "ساخت…" : "بساز"}
              </button>
            </div>
          </div>
        </Card>
      )}

      {loading ? (
        <Card>Loading…</Card>
      ) : rules.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            هنوز هیچ rule‌ای نساختی. روی «+ rule جدید» بزن.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2 mb-4">
          {rules.map((r) => (
            <Card key={r.id} className="!p-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <Link
                  href={`/rules/${r.id}`}
                  className="flex-1 min-w-0"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium hover:underline">
                      {r.name}
                    </span>
                    {r.enabled ? (
                      <Badge tone="success">on</Badge>
                    ) : (
                      <Badge tone="neutral">off</Badge>
                    )}
                    <Badge tone="info">{r.recipientCount} گیرنده</Badge>
                    {r.forwardFormat && (
                      <Badge tone="warn">format سفارشی</Badge>
                    )}
                  </div>
                  <div
                    className="text-[11px] text-[var(--color-text-dim)] mt-1 line-clamp-2"
                    dir="auto"
                  >
                    {r.description}
                  </div>
                </Link>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => toggle(r.id, e.target.checked)}
                    />
                    enabled
                  </label>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <Card className="mb-4">
          <div className="text-xs font-medium mb-2">
            🏷 پیام‌های match شده اخیر ({recent.length})
          </div>
          <div className="flex flex-col gap-1">
            {recent.map((m) => (
              <Link
                key={m.id}
                href={`/rules/${m.ruleId}`}
                className="block p-2 rounded-md bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] text-xs"
              >
                <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-dim)] mb-1 flex-wrap">
                  <Badge tone="info">{m.ruleName}</Badge>
                  <span>{m.senderName}</span>
                  <span>·</span>
                  <span>{relTime(m.matchedAt)}</span>
                  <span>·</span>
                  <span>
                    {m.forwardedTo.length > 0
                      ? `→ ${m.forwardedTo.length} گیرنده`
                      : "نگه‌ داشته شده (gate)"}
                  </span>
                </div>
                <div
                  dir="auto"
                  style={{ unicodeBidi: "plaintext" }}
                  className="whitespace-pre-wrap break-words"
                >
                  {truncate(m.formattedText ?? m.messageText, 180)}
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </Shell>
  );
}
