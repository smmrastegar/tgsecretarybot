"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card } from "./Card";
import { relTime } from "@/lib/format";

type Alias = {
  id: number;
  itemId: number;
  alias: string;
  createdAt: string;
};

export type WatchlistItem = {
  id: number;
  concept: string;
  description: string | null;
  enabled: boolean;
  matchCount: number;
  lastMatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
  aliases: string[];
  emoji: string | null;
  priority: "low" | "normal" | "high";
  forwardToInbox: boolean;
  cooldownOverrideMinutes: number | null;
  context: string | null;
};

type Match = {
  id: number;
  itemId: number;
  chatId: number;
  chatTitle: string | null;
  messageLogId: number | null;
  sourceMessageId: number | null;
  senderName: string | null;
  quote: string;
  reason: string | null;
  forwardedTo: number | null;
  createdAt: string;
};

export default function WatchlistPanel() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [newConcept, setNewConcept] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [activeItemId, setActiveItemId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/note-watchlist");
      if (r.ok) {
        const j = (await r.json()) as { items: WatchlistItem[] };
        setItems(j.items ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMatches = useCallback(async (itemId: number | null) => {
    const q = itemId ? `?itemId=${itemId}` : "";
    const r = await fetch(`/api/note-watchlist/matches${q}`);
    if (r.ok) {
      const j = (await r.json()) as { matches: Match[] };
      setMatches(j.matches ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadMatches(activeItemId);
  }, [activeItemId, loadMatches]);

  const create = useCallback(async () => {
    if (!newConcept.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/note-watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concept: newConcept.trim(),
          description: newDesc.trim() || null,
        }),
      });
      if (r.ok) {
        setNewConcept("");
        setNewDesc("");
        load();
      }
    } finally {
      setCreating(false);
    }
  }, [newConcept, newDesc, load]);

  const update = useCallback(
    async (id: number, patch: Partial<WatchlistItem>) => {
      await fetch(`/api/note-watchlist/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: number, concept: string) => {
      if (!confirm(`«${concept}» پاک بشه؟ همه‌ی match های قبلیش هم پاک می‌شن.`))
        return;
      await fetch(`/api/note-watchlist/${id}`, { method: "DELETE" });
      if (activeItemId === id) setActiveItemId(null);
      load();
    },
    [load, activeItemId],
  );

  return (
    <>
      <Card className="mb-4">
        <div className="text-xs font-medium mb-2">+ مفهوم جدید</div>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={newConcept}
            onChange={(e) => setNewConcept(e.target.value)}
            placeholder="مفهوم (مثلاً «کنسرت امیر بال»، «سفارش جدید»، «هشدار امنیتی»)"
            className="text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-1.5"
          />
          <textarea
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="توضیح اختیاری برای AI — این مفهوم دقیقا یعنی چی، چه پیام‌هایی match محسوب می‌شن"
            rows={2}
            className="text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-1.5"
          />
          <div className="flex justify-end">
            <button
              onClick={create}
              disabled={creating || !newConcept.trim()}
              className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
            >
              {creating ? "..." : "بساز"}
            </button>
          </div>
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h2 className="text-sm font-medium mb-2">مفاهیم تعریف‌شده</h2>
          {loading ? (
            <Card>Loading…</Card>
          ) : items.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--color-text-dim)]">
                هنوز هیچ مفهومی تعریف نشده. بالا اولیشو اضافه کن.
              </p>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {items.map((it) => (
                <ItemCard
                  key={it.id}
                  item={it}
                  active={it.id === activeItemId}
                  onClick={() =>
                    setActiveItemId((cur) => (cur === it.id ? null : it.id))
                  }
                  onUpdate={(patch) => update(it.id, patch)}
                  onDelete={() => remove(it.id, it.concept)}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-sm font-medium mb-2">
            match های اخیر{" "}
            {activeItemId && (
              <span className="text-[var(--color-text-dim)]">
                · {items.find((i) => i.id === activeItemId)?.concept ?? "?"}
                <button
                  onClick={() => setActiveItemId(null)}
                  className="text-[10px] text-[var(--color-accent)] mr-2 ms-2 hover:underline"
                >
                  پاک کردن فیلتر
                </button>
              </span>
            )}
          </h2>
          {matches.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--color-text-dim)]">
                هیچ match ای ثبت نشده.
              </p>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {matches.map((m) => {
                const item = items.find((i) => i.id === m.itemId);
                return (
                  <Card key={m.id} className="!p-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap mb-1.5">
                      <div className="font-medium text-sm">
                        {item?.emoji ? `${item.emoji} ` : ""}
                        {item?.concept ?? `item ${m.itemId}`}
                      </div>
                      <div className="text-[10px] text-[var(--color-text-dim)]">
                        {relTime(m.createdAt)}
                      </div>
                    </div>
                    <div className="text-[11px] text-[var(--color-text-dim)] mb-1.5">
                      از: <span className="text-white">{m.senderName ?? "?"}</span>
                      {m.chatTitle && (
                        <span>
                          {" · "}
                          {m.chatTitle}
                        </span>
                      )}
                      {m.forwardedTo && (
                        <span className="mr-2 ms-2">
                          <Badge tone="success">📤 forwarded</Badge>
                        </span>
                      )}
                    </div>
                    <div className="text-sm leading-relaxed bg-[var(--color-surface-2)] rounded-md px-2 py-1.5">
                      «{m.quote}»
                    </div>
                    {m.reason && (
                      <div className="text-[11px] text-[var(--color-text-dim)] mt-1.5">
                        🔎 {m.reason}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ItemCard({
  item,
  active,
  onClick,
  onUpdate,
  onDelete,
}: {
  item: WatchlistItem;
  active: boolean;
  onClick: () => void;
  onUpdate: (patch: Partial<WatchlistItem>) => void;
  onDelete: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  return (
    <Card
      className={`!p-3 transition-colors ${
        active ? "border-[var(--color-accent)]" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap mb-1.5">
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
          {item.emoji && (
            <span className="text-base">{item.emoji}</span>
          )}
          <input
            type="text"
            defaultValue={item.concept}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== item.concept) onUpdate({ concept: v });
            }}
            className="text-sm font-medium bg-transparent border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none px-1 py-0.5 min-w-0 flex-1"
          />
          {item.enabled ? (
            <Badge tone="success">on</Badge>
          ) : (
            <Badge tone="neutral">off</Badge>
          )}
          {item.priority === "high" && <Badge tone="danger">🚨 high</Badge>}
          {item.priority === "low" && <Badge tone="neutral">🔅 low</Badge>}
          {item.matchCount > 0 && (
            <Badge tone="info">{item.matchCount} match</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={item.enabled}
              onChange={(e) => onUpdate({ enabled: e.target.checked })}
            />
            enabled
          </label>
          <button
            onClick={onDelete}
            className="text-[10px] text-red-300 hover:text-red-200 px-1.5 py-0.5 rounded"
          >
            🗑
          </button>
        </div>
      </div>
      <textarea
        defaultValue={item.description ?? ""}
        onBlur={(e) => {
          const v = e.target.value;
          if (v !== (item.description ?? "")) onUpdate({ description: v || null });
        }}
        onInput={(e) => {
          // Auto-grow so the operator can read the full description
          // they wrote — was clipped to 2 rows.
          const ta = e.currentTarget;
          ta.style.height = "auto";
          ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`;
        }}
        placeholder="توضیح اختیاری برای AI — مثلاً نام مستعار، اسم گروه‌ها، اصطلاحات مرتبط ..."
        rows={4}
        className="w-full text-[11px] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 mb-1.5 leading-relaxed"
        style={{ minHeight: "5rem" }}
      />
      <ContextEditor item={item} onUpdate={onUpdate} />
      <AliasEditor item={item} />

      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <ExtractAliasesButton
          itemId={item.id}
          description={item.description}
          existingAliases={item.aliases}
        />
        <button
          onClick={() => setAdvanced((v) => !v)}
          className="text-[10px] text-[var(--color-accent)] hover:underline"
        >
          {advanced ? "▴ بستن تنظیمات پیشرفته" : "▾ تنظیمات پیشرفته"}
        </button>
        <button
          onClick={() => setTesting((v) => !v)}
          className="text-[10px] text-[var(--color-accent)] hover:underline"
        >
          {testing ? "▴ بستن تست" : "🧪 تست"}
        </button>
      </div>
      {advanced && (
        <AdvancedItemSettings item={item} onUpdate={onUpdate} />
      )}
      {testing && <ConceptTester itemId={item.id} concept={item.concept} />}

      <div className="flex items-center justify-between text-[10px] text-[var(--color-text-dim)]">
        <button
          onClick={onClick}
          className="text-[var(--color-accent)] hover:underline"
        >
          {active ? "📂 فیلتر شده" : "نمایش match ها"}
        </button>
        {item.lastMatchedAt && (
          <span>آخرین: {relTime(item.lastMatchedAt)}</span>
        )}
      </div>
    </Card>
  );
}

function AdvancedItemSettings({
  item,
  onUpdate,
}: {
  item: WatchlistItem;
  onUpdate: (patch: Partial<WatchlistItem>) => void;
}) {
  return (
    <div className="border border-[var(--color-border)] rounded-md p-2 mb-2 bg-[var(--color-surface-2)]/40">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] flex flex-col gap-1">
          <span className="text-[var(--color-text-dim)]">آیکن (emoji)</span>
          <input
            type="text"
            defaultValue={item.emoji ?? ""}
            placeholder="🎵 🏥 🚨 ..."
            maxLength={4}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (item.emoji ?? "")) onUpdate({ emoji: v || null });
            }}
            className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
          />
        </label>
        <label className="text-[10px] flex flex-col gap-1">
          <span className="text-[var(--color-text-dim)]">اولویت</span>
          <select
            defaultValue={item.priority}
            onChange={(e) =>
              onUpdate({
                priority: e.target.value as "low" | "normal" | "high",
              })
            }
            className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
          >
            <option value="low">🔅 پایین</option>
            <option value="normal">عادی</option>
            <option value="high">🚨 بالا</option>
          </select>
        </label>
        <label className="text-[10px] flex items-center gap-2 cursor-pointer col-span-1">
          <input
            type="checkbox"
            checked={item.forwardToInbox}
            onChange={(e) => onUpdate({ forwardToInbox: e.target.checked })}
          />
          <span>ارسال به کانال notes_inbox</span>
        </label>
        <label className="text-[10px] flex flex-col gap-1">
          <span className="text-[var(--color-text-dim)]">
            cooldown اختصاصی (دقیقه — خالی = global)
          </span>
          <input
            type="number"
            min={0}
            max={10080}
            defaultValue={item.cooldownOverrideMinutes ?? ""}
            placeholder="خالی"
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const next: number | null =
                raw === "" ? null : Math.max(0, Math.round(Number(raw)));
              if (next !== item.cooldownOverrideMinutes) {
                onUpdate({ cooldownOverrideMinutes: next });
              }
            }}
            className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
          />
        </label>
      </div>
    </div>
  );
}

function ContextEditor({
  item,
  onUpdate,
}: {
  item: WatchlistItem;
  onUpdate: (patch: Partial<WatchlistItem>) => void;
}) {
  // Context is stored as a single string in DB; the UI splits on `/`
  // (matches the existing examples) so each domain word becomes a chip.
  const tokens = (item.context ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  const [draft, setDraft] = useState("");

  const persist = (next: string[]) => {
    const joined = next.join(" / ");
    if (joined === (item.context ?? "")) return;
    onUpdate({ context: joined || null });
  };

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (tokens.includes(v)) {
      setDraft("");
      return;
    }
    persist([...tokens, v]);
    setDraft("");
  };

  const remove = (token: string) => {
    persist(tokens.filter((t) => t !== token));
  };

  return (
    <div className="mb-2 border-t border-[var(--color-border)] pt-2">
      <div className="text-[10px] text-[var(--color-text-dim)] mb-1.5">
        🎯 فضای جستجو — هر کلمه یک chip. خالی = همه‌جا.
      </div>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {tokens.length === 0 && (
          <span className="text-[10px] text-[var(--color-text-dim)] italic">
            فضایی تعریف نشده — همه پیام‌ها بررسی می‌شن.
          </span>
        )}
        {tokens.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 text-[10px] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-1.5 py-0.5"
          >
            {t}
            <button
              onClick={() => remove(t)}
              className="text-red-300 hover:text-red-200"
              aria-label={`remove ${t}`}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="+ کلمه فضا (مثلاً music) — Enter"
          className="flex-1 min-w-0 text-[11px] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          onClick={add}
          disabled={!draft.trim()}
          className="text-[11px] px-2 py-1 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          +
        </button>
      </div>
    </div>
  );
}

function AliasEditor({ item }: { item: WatchlistItem }) {
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [newAlias, setNewAlias] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/note-watchlist/${item.id}/aliases`);
    if (r.ok) {
      const j = (await r.json()) as { aliases: Alias[] };
      setAliases(j.aliases ?? []);
    }
    setLoaded(true);
  }, [item.id]);

  useEffect(() => {
    if (item.aliases?.length) {
      setAliases(
        item.aliases.map((alias, i) => ({
          id: -i - 1,
          itemId: item.id,
          alias,
          createdAt: "",
        })),
      );
    }
    load();
  }, [item.id, item.aliases, load]);

  const add = async () => {
    const v = newAlias.trim();
    if (!v) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/note-watchlist/${item.id}/aliases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: v }),
      });
      if (r.ok) {
        setNewAlias("");
        const j = (await r.json()) as { aliases: Alias[] };
        setAliases(j.aliases ?? []);
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (aliasId: number) => {
    if (aliasId < 0) {
      await load();
      return;
    }
    setAliases((cur) => cur.filter((a) => a.id !== aliasId));
    await fetch(`/api/note-watchlist/aliases/${aliasId}`, {
      method: "DELETE",
    });
  };

  return (
    <div className="mb-2 border-t border-[var(--color-border)] pt-2">
      <div className="text-[10px] text-[var(--color-text-dim)] mb-1.5">
        راه‌های رسیدن به این مفهوم — اسامی، اصطلاحات، اسم لاتین، اسم کوتاه، ...
      </div>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {loaded && aliases.length === 0 && (
          <span className="text-[10px] text-[var(--color-text-dim)] italic">
            هنوز alias ای تعریف نشده — فقط روی «{item.concept}» match می‌شه.
          </span>
        )}
        {aliases.map((a) => (
          <span
            key={a.id}
            className="inline-flex items-center gap-1 text-[10px] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-1.5 py-0.5"
          >
            {a.alias}
            <button
              onClick={() => remove(a.id)}
              className="text-red-300 hover:text-red-200"
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          type="text"
          value={newAlias}
          onChange={(e) => setNewAlias(e.target.value)}
          placeholder="+ alias جدید (Enter)"
          className="flex-1 min-w-0 text-[11px] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          onClick={add}
          disabled={busy || !newAlias.trim()}
          className="text-[11px] px-2 py-1 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          +
        </button>
      </div>
    </div>
  );
}

type TestVerdict =
  | "skipped"
  | "no_llm_match"
  | "validator_dropped"
  | "would_be_cooled_down"
  | "match"
  | "llm_failed";

type TestResponse = {
  ok: boolean;
  verdict: TestVerdict;
  reason: string;
  gates?: {
    masterEnabled: boolean;
    minLen: number;
    textLen: number;
    passesLength: boolean;
    itemEnabled: boolean;
    forwardToInbox: boolean;
    forwardDefault: boolean;
    cooldownMin: number;
  };
  cooldownActive?: boolean | null;
  debug?: {
    llmRaw: Array<{
      itemId: number;
      matchedAlias: string | null;
      quote: string;
      reason: string;
    }>;
    droppedByValidator: Array<{
      itemId: number;
      concept: string;
      matchedAlias: string | null;
      quote: string;
      reason: string;
    }>;
    finalMatches: Array<{
      itemId: number;
      matchedAlias: string | null;
      quote: string;
      reason: string;
    }>;
    llmFailed: boolean;
  };
  error?: string;
};

function ConceptTester({
  itemId,
  concept,
}: {
  itemId: number;
  concept: string;
}) {
  const [text, setText] = useState("");
  const [chatId, setChatId] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResponse | null>(null);

  const run = async () => {
    if (!text.trim()) return;
    setRunning(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = { text: text.trim() };
      const cid = Number(chatId.trim());
      if (Number.isFinite(cid) && cid !== 0) body.chatId = cid;
      const r = await fetch(`/api/note-watchlist/${itemId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as TestResponse;
      setResult(j);
    } catch (e) {
      setResult({
        ok: false,
        verdict: "llm_failed",
        reason: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRunning(false);
    }
  };

  const verdictTone = (() => {
    switch (result?.verdict) {
      case "match":
        return "bg-emerald-900/40 border-emerald-800 text-emerald-200";
      case "would_be_cooled_down":
        return "bg-amber-900/40 border-amber-800 text-amber-200";
      case "no_llm_match":
      case "validator_dropped":
      case "skipped":
        return "bg-amber-900/40 border-amber-800 text-amber-200";
      case "llm_failed":
        return "bg-red-900/40 border-red-800 text-red-200";
      default:
        return "";
    }
  })();

  return (
    <div
      className="border border-[var(--color-border)] rounded-md p-2 mb-2 bg-[var(--color-surface-2)]/40"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[10px] text-[var(--color-text-dim)] mb-1.5">
        یه پیام نمونه پیست کن تا ببینی این concept روش match می‌شه یا نه و
        دقیقاً چی شد. (هزینه: یک LLM call.)
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="متن نمونه (مثلاً «آلبوم جدید آرمان گرشاسبی پخش شد»)"
        rows={3}
        className="w-full text-[11px] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 mb-1.5"
      />
      <div className="flex gap-1.5 flex-wrap items-center mb-2">
        <input
          type="text"
          inputMode="numeric"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          placeholder="chat ID (اختیاری — برای چک cooldown)"
          dir="ltr"
          className="flex-1 min-w-[120px] text-[11px] tabular-nums bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
        />
        <button
          onClick={run}
          disabled={running || !text.trim()}
          className="text-[11px] px-3 py-1 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          {running ? "..." : "🧪 اجرا"}
        </button>
      </div>
      {result && (
        <div
          className={`text-[11px] border rounded-md p-2 mb-1 ${verdictTone}`}
        >
          <div className="font-medium mb-1">
            verdict: {result.verdict}
          </div>
          <div className="mb-1.5">{result.reason}</div>
          {result.debug && result.debug.llmRaw.length > 0 && (
            <div className="mt-1 pt-1 border-t border-current/30">
              <div className="text-[10px] opacity-80 mb-0.5">
                LLM گفت match (قبل از validator):
              </div>
              {result.debug.llmRaw.map((m, i) => (
                <div
                  key={i}
                  className="text-[10px] opacity-90 break-words"
                >
                  • alias=<b>{m.matchedAlias ?? "—"}</b> · quote=«{m.quote}» ·{" "}
                  {m.reason}
                </div>
              ))}
            </div>
          )}
          {result.debug && result.debug.droppedByValidator.length > 0 && (
            <div className="mt-1 pt-1 border-t border-current/30">
              <div className="text-[10px] opacity-80 mb-0.5">
                validator رد کرد (alias یا concept به‌صورت whole-word توی
                متن نیست):
              </div>
              {result.debug.droppedByValidator.map((m, i) => (
                <div key={i} className="text-[10px] opacity-90 break-words">
                  • «{m.quote}»
                </div>
              ))}
              <div className="text-[10px] opacity-80 mt-1">
                راه‌حل: یه alias دقیق‌تر اضافه کن که واقعاً توی پیام بیاد
                (مثلاً «{concept}»‌ی که توی پیام دیدی رو دقیقاً copy کن).
              </div>
            </div>
          )}
          {result.gates && (
            <details className="mt-1.5 text-[10px] opacity-80">
              <summary className="cursor-pointer">جزئیات gate ها</summary>
              <pre className="text-[10px] mt-1 overflow-x-auto">
{JSON.stringify(result.gates, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function ExtractAliasesButton({
  itemId,
  description,
  existingAliases,
}: {
  itemId: number;
  description: string | null;
  existingAliases: string[];
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const disabled = !description || !description.trim();
  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(
        `/api/note-watchlist/${itemId}/extract-aliases`,
        { method: "POST" },
      );
      const j = (await r.json()) as {
        ok: boolean;
        added?: string[];
        extracted?: string[];
        skippedAsDuplicates?: string[];
        error?: string;
      };
      if (!j.ok) {
        setMsg(j.error ?? "ناموفق");
      } else {
        const added = j.added ?? [];
        const extracted = j.extracted ?? [];
        if (added.length === 0 && extracted.length === 0) {
          setMsg("هیچ alias جدیدی پیدا نشد.");
        } else if (added.length === 0) {
          setMsg(`${extracted.length} alias پیدا شد ولی همه از قبل بودن.`);
        } else {
          setMsg(`✅ ${added.length} alias اضافه شد: ${added.join("، ")}`);
        }
        // Soft reload: the parent's load() refresh happens on the
        // next "onUpdate" cycle. For an immediate visual update,
        // ping the page reload.
        setTimeout(() => {
          if (typeof window !== "undefined") window.location.reload();
        }, 1500);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={run}
        disabled={busy || disabled}
        title={
          disabled
            ? "اول یه توضیح برای این concept بنویس"
            : `${existingAliases.length} alias الان توی لیست هست`
        }
        className="text-[10px] px-2 py-0.5 rounded-md border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:opacity-50"
      >
        {busy ? "..." : "🤖 استخراج alias از توضیح"}
      </button>
      {msg && (
        <span className="text-[10px] text-[var(--color-text-dim)]">
          {msg}
        </span>
      )}
    </span>
  );
}
