"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Card } from "./Card";
import EmptyState from "./ui/EmptyState";
import Section, { Pill } from "./ui/Section";
import { confirmDialog } from "./ui/Dialogs";
import { relTime } from "@/lib/format";

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

const INPUT = "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3";

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
  /** learned from 🚩 / ✅ on past notices */
  feedback?: { rejected: string[]; confirmed: string[] };
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

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mb-3 rounded-2xl border border-rose-400/50 bg-rose-500/10 px-4 py-3 text-center">
      <p className="text-sm text-rose-200 leading-6">خطا: {message}</p>
      <div className="mt-2 flex">
        <button type="button" onClick={onRetry} className="min-h-10 px-4 rounded-xl border border-rose-400/50 text-sm text-rose-100">تلاش دوباره</button>
      </div>
    </div>
  );
}

export default function WatchlistPanel() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const [newConcept, setNewConcept] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [matchesOpen, setMatchesOpen] = useState(true);
  const matchesRef = useRef<HTMLDivElement | null>(null);

  // silent = refresh after an edit: keep the cards (and whichever ones are expanded) on screen.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/note-watchlist");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { items: WatchlistItem[] };
      setItems(j.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMatches = useCallback(async (itemId: number | null) => {
    const q = itemId ? `?itemId=${itemId}` : "";
    setMatchesError(null);
    try {
      const r = await fetch(`/api/note-watchlist/matches${q}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { matches: Match[] };
      setMatches(j.matches ?? []);
    } catch (e) {
      setMatchesError(e instanceof Error ? e.message : String(e));
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
        setFormOpen(false);
        load(true);
      } else {
        setError(`ساخته نشد (HTTP ${r.status})`);
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
      load(true);
    },
    [load],
  );

  const remove = useCallback(
    async (id: number, concept: string) => {
      if (!(await confirmDialog(`«${concept}» پاک بشه؟ همه‌ی match های قبلیش هم پاک می‌شن.`, { danger: true, confirmLabel: "پاک کن" })))
        return;
      await fetch(`/api/note-watchlist/${id}`, { method: "DELETE" });
      if (activeItemId === id) setActiveItemId(null);
      load(true);
    },
    [load, activeItemId],
  );

  const showMatches = (id: number) => {
    const same = activeItemId === id;
    setActiveItemId(same ? null : id);
    if (!same) {
      setMatchesOpen(true);
      setTimeout(() => matchesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
  };

  const activeItem = items.find((i) => i.id === activeItemId);

  return (
    <>
      <Section icon="＋" title="مفهوم جدید" summary="مفهومی که روی همه‌ی چت‌ها دیده‌بانی شود" open={formOpen} onOpenChange={setFormOpen}>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={newConcept}
            onChange={(e) => setNewConcept(e.target.value)}
            placeholder="مفهوم (مثلاً «کنسرت امیر بال»، «سفارش جدید»، «هشدار امنیتی»)"
            aria-label="مفهوم جدید"
            className={INPUT}
          />
          <textarea
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="توضیح اختیاری برای AI — این مفهوم دقیقا یعنی چی، چه پیام‌هایی match محسوب می‌شن"
            aria-label="توضیح مفهوم"
            rows={3}
            className="w-full min-h-24 text-sm leading-7 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 py-2"
          />
          <button
            type="button"
            onClick={create}
            disabled={creating || !newConcept.trim()}
            className="min-h-12 rounded-xl bg-[var(--color-accent)] text-white text-base font-medium disabled:opacity-50"
          >
            {creating ? "در حال ساخت…" : "بساز"}
          </button>
        </div>
      </Section>

      {error && <ErrorBox message={error} onRetry={() => load()} />}

      <div className="grid md:grid-cols-2 gap-4 items-start">
        <div>
          <h2 className="text-sm font-medium mb-2 text-center">
            مفاهیم تعریف‌شده {items.length > 0 && <span className="text-[var(--color-text-dim)]">{fa(items.length)}</span>}
          </h2>
          {loading ? (
            <Card>
              <div className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</div>
            </Card>
          ) : items.length === 0 ? (
            error ? null : (
              <EmptyState
                icon="🕵️"
                title="هنوز هیچ مفهومی تعریف نشده"
                hint="اولین مفهوم را اضافه کن تا AI روی همه‌ی چت‌ها دنبالش بگردد."
                action={
                  <button type="button" onClick={() => setFormOpen(true)} className="min-h-10 px-4 rounded-xl bg-[var(--color-accent)] text-white text-sm">
                    + مفهوم جدید
                  </button>
                }
              />
            )
          ) : (
            <div>
              {items.map((it) => (
                <ItemCard
                  key={it.id}
                  item={it}
                  active={it.id === activeItemId}
                  onShowMatches={() => showMatches(it.id)}
                  onUpdate={(patch) => update(it.id, patch)}
                  onDelete={() => remove(it.id, it.concept)}
                />
              ))}
            </div>
          )}
        </div>

        <div ref={matchesRef} className="scroll-mt-20">
          <h2 className="sr-only">match های اخیر</h2>
          <Section
            icon="🔎"
            title="match های اخیر"
            summary={activeItem ? `فیلتر: ${activeItem.concept}` : "همه‌ی مفاهیم"}
            badge={<Pill>{fa(matches.length)}</Pill>}
            open={matchesOpen}
            onOpenChange={setMatchesOpen}
          >
            {activeItemId && (
              <div className="mb-3 flex">
                <button
                  type="button"
                  onClick={() => setActiveItemId(null)}
                  className="min-h-10 px-3 rounded-xl border border-[var(--color-border)] text-xs text-[var(--color-accent)]"
                >
                  پاک کردن فیلتر
                </button>
              </div>
            )}
            {matchesError && <ErrorBox message={matchesError} onRetry={() => loadMatches(activeItemId)} />}
            {matches.length === 0 ? (
              matchesError ? null : <EmptyState icon="🔎" title="هیچ match ای ثبت نشده" />
            ) : (
              <div className="flex flex-col gap-2">
                {matches.map((m) => {
                  const item = items.find((i) => i.id === m.itemId);
                  return (
                    <Card key={m.id} className="!p-3">
                      <div className="font-medium text-sm leading-6 break-words">
                        {item?.emoji ? `${item.emoji} ` : ""}
                        {item?.concept ?? `item ${m.itemId}`}
                      </div>
                      <div className="text-xs text-[var(--color-text-dim)] mt-0.5">
                        {relTime(m.createdAt)}
                      </div>
                      <div className="text-xs leading-6 text-[var(--color-text-dim)] mt-1.5">
                        از: <span className="text-white">{m.senderName ?? "?"}</span>
                        {m.chatTitle && <span>{" · "}{m.chatTitle}</span>}
                      </div>
                      {m.forwardedTo && (
                        <div className="mt-1.5">
                          <Badge tone="success">📤 forwarded</Badge>
                        </div>
                      )}
                      <div dir="auto" className="mt-2 text-sm leading-7 bg-[var(--color-surface-2)] rounded-xl px-3 py-2">
                        «{m.quote}»
                      </div>
                      {m.reason && (
                        <div className="text-xs leading-6 text-[var(--color-text-dim)] mt-1.5">
                          🔎 {m.reason}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

// One concept = one collapsed row (emoji, name, match count, on/off) that opens into its editor.
function ItemCard({
  item,
  active,
  onShowMatches,
  onUpdate,
  onDelete,
}: {
  item: WatchlistItem;
  active: boolean;
  onShowMatches: () => void;
  onUpdate: (patch: Partial<WatchlistItem>) => void;
  onDelete: () => void;
}) {
  const summary = [
    item.matchCount > 0 ? `${fa(item.matchCount)} match` : "بدون match",
    item.priority === "high" ? "🚨 اولویت بالا" : item.priority === "low" ? "🔅 اولویت پایین" : null,
  ].filter(Boolean).join("، ");
  return (
    <Section
      icon={item.emoji || "🕵️"}
      title={item.concept}
      summary={summary}
      badge={<Pill tone={item.enabled ? "ok" : "neutral"}>{item.enabled ? "روشن" : "خاموش"}</Pill>}
      className={active ? "!border-[var(--color-accent)]" : ""}
    >
      <label className="flex items-center justify-center gap-2 min-h-11 cursor-pointer text-sm">
        <input
          type="checkbox"
          checked={item.enabled}
          onChange={(e) => onUpdate({ enabled: e.target.checked })}
        />
        فعال
      </label>

      <label className="block text-xs text-[var(--color-text-dim)] mt-2 mb-1.5" htmlFor={`wl-name-${item.id}`}>نام مفهوم</label>
      <input
        id={`wl-name-${item.id}`}
        type="text"
        dir="auto"
        defaultValue={item.concept}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && v !== item.concept) onUpdate({ concept: v });
        }}
        className={`${INPUT} font-medium`}
      />

      <label className="block text-xs text-[var(--color-text-dim)] mt-3 mb-1.5" htmlFor={`wl-desc-${item.id}`}>توضیح برای AI</label>
      <textarea
        id={`wl-desc-${item.id}`}
        dir="auto"
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
        className="w-full text-sm leading-7 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 py-2"
        style={{ minHeight: "6rem" }}
      />
      <ContextEditor item={item} onUpdate={onUpdate} />
      <AliasEditor item={item} />

      <div className="mt-3 flex">
        <ExtractAliasesButton
          itemId={item.id}
          description={item.description}
          existingAliases={item.aliases}
        />
      </div>

      <Section icon="⚙️" title="تنظیمات پیشرفته" summary="آیکن، اولویت، cooldown" className="!mb-0 mt-3">
        <AdvancedItemSettings item={item} onUpdate={onUpdate} />
      </Section>
      <Section icon="🧪" title="تست" summary="روی یک پیام نمونه امتحان کن" className="!mb-0 mt-3">
        <ConceptTester itemId={item.id} concept={item.concept} />
      </Section>

      {item.feedback && (item.feedback.rejected.length > 0 || item.feedback.confirmed.length > 0) && (
        <div className="text-xs mt-4">
          <div className="text-[var(--color-text-dim)] mb-1.5 leading-6">
            🧠 یادگرفته از گزارش‌های تو — این‌ها دیگر تطابق حساب نمی‌شوند مگر نام کامل بیاید:
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {item.feedback.rejected.slice(0, 12).map((q) => (
              <span key={`r-${q}`} className="px-2 py-1 rounded-lg bg-red-900/30 text-red-200 border border-red-900" title="🚩 رد شده">
                🚩 {q.length > 40 ? `${q.slice(0, 40)}…` : q}
              </span>
            ))}
            {item.feedback.confirmed.slice(0, 6).map((q) => (
              <span key={`c-${q}`} className="px-2 py-1 rounded-lg bg-emerald-900/30 text-emerald-200 border border-emerald-900" title="✅ تأیید شده">
                ✅ {q.length > 40 ? `${q.slice(0, 40)}…` : q}
              </span>
            ))}
          </div>
        </div>
      )}

      {item.lastMatchedAt && (
        <div className="mt-4 text-xs text-[var(--color-text-dim)]">
          آخرین match: {relTime(item.lastMatchedAt)}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onShowMatches}
          className="min-h-10 px-3 rounded-xl border border-[var(--color-accent)] text-xs text-[var(--color-accent)] active:bg-[var(--color-accent)]/10"
        >
          {active ? "📂 فیلتر شده" : "نمایش match ها"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="min-h-10 px-3 rounded-xl border border-red-800 text-xs text-red-300 active:bg-red-900/30"
        >
          🗑 حذف
        </button>
      </div>
    </Section>
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
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-start">
      {/* text-start: a small labelled form (label above its field), not card prose. */}
      <label className="text-xs flex flex-col gap-1.5">
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
          className={INPUT}
        />
      </label>
      <label className="text-xs flex flex-col gap-1.5">
        <span className="text-[var(--color-text-dim)]">اولویت</span>
        <select
          defaultValue={item.priority}
          onChange={(e) =>
            onUpdate({
              priority: e.target.value as "low" | "normal" | "high",
            })
          }
          className={INPUT}
        >
          <option value="low">🔅 پایین</option>
          <option value="normal">عادی</option>
          <option value="high">🚨 بالا</option>
        </select>
      </label>
      <label className="text-xs flex flex-col gap-1.5">
        <span className="text-[var(--color-text-dim)]">
          cooldown اختصاصی (دقیقه — خالی = global)
        </span>
        <input
          type="number"
          inputMode="numeric"
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
          className={INPUT}
        />
      </label>
      <label className="text-sm flex items-center gap-2 cursor-pointer min-h-11 sm:self-end">
        <input
          type="checkbox"
          checked={item.forwardToInbox}
          onChange={(e) => onUpdate({ forwardToInbox: e.target.checked })}
        />
        <span>ارسال به کانال notes_inbox</span>
      </label>
    </div>
  );
}

// A removable chip: text + a 40px ✕ so the whole chip is a comfortable touch target.
function RemovableChip({ text, label, onRemove }: { text: string; label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center max-w-full min-h-10 ps-3 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-full">
      <span dir="auto" className="min-w-0 break-words py-1">{text}</span>
      <button type="button" onClick={onRemove} aria-label={label} className="shrink-0 w-10 h-10 grid place-items-center text-red-300">
        ✕
      </button>
    </span>
  );
}

// Input + "+" button used by both chip editors.
function AddRow({ value, onChange, onAdd, placeholder, disabled }: {
  value: string; onChange: (v: string) => void; onAdd: () => void; placeholder: string; disabled: boolean;
}) {
  return (
    <div className="flex gap-2">
      <input
        type="text"
        dir="auto"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`${INPUT} flex-1 min-w-0`}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onAdd();
          }
        }}
      />
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        aria-label="افزودن"
        className="shrink-0 min-w-11 min-h-11 rounded-xl bg-[var(--color-accent)] text-white text-lg disabled:opacity-50"
      >
        +
      </button>
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
    <div className="mt-4 border-t border-[var(--color-border)] pt-3">
      <div className="text-xs leading-6 text-[var(--color-text-dim)] mb-2">
        🎯 فضای جستجو — هر کلمه یک chip. خالی = همه‌جا.
      </div>
      <div className="flex flex-wrap justify-center gap-1.5 mb-2">
        {tokens.length === 0 && (
          <span className="text-xs text-[var(--color-text-dim)] italic">
            فضایی تعریف نشده — همه پیام‌ها بررسی می‌شن.
          </span>
        )}
        {tokens.map((t) => (
          <RemovableChip key={t} text={t} label={`remove ${t}`} onRemove={() => remove(t)} />
        ))}
      </div>
      <AddRow value={draft} onChange={setDraft} onAdd={add} placeholder="+ کلمه فضا (مثلاً music) — Enter" disabled={!draft.trim()} />
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
    <div className="mt-4 border-t border-[var(--color-border)] pt-3">
      <div className="text-xs leading-6 text-[var(--color-text-dim)] mb-2">
        راه‌های رسیدن به این مفهوم — اسامی، اصطلاحات، اسم لاتین، اسم کوتاه، ...
      </div>
      <div className="flex flex-wrap justify-center gap-1.5 mb-2">
        {loaded && aliases.length === 0 && (
          <span className="text-xs leading-6 text-[var(--color-text-dim)] italic">
            هنوز alias ای تعریف نشده — فقط روی «{item.concept}» match می‌شه.
          </span>
        )}
        {aliases.map((a) => (
          <RemovableChip key={a.id} text={a.alias} label={`حذف ${a.alias}`} onRemove={() => remove(a.id)} />
        ))}
      </div>
      <AddRow value={newAlias} onChange={setNewAlias} onAdd={add} placeholder="+ alias جدید (Enter)" disabled={busy || !newAlias.trim()} />
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
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-xs leading-6 text-[var(--color-text-dim)] mb-2">
        یه پیام نمونه پیست کن تا ببینی این concept روش match می‌شه یا نه و
        دقیقاً چی شد. (هزینه: یک LLM call.)
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        dir="auto"
        placeholder="متن نمونه (مثلاً «آلبوم جدید آرمان گرشاسبی پخش شد»)"
        aria-label="متن نمونه"
        rows={3}
        className="w-full text-sm leading-7 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 py-2 mb-2"
      />
      <div className="flex gap-2 flex-wrap items-center mb-2">
        <input
          type="text"
          inputMode="numeric"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          placeholder="chat ID (اختیاری — برای چک cooldown)"
          dir="ltr"
          aria-label="chat ID"
          className="flex-1 min-w-0 min-h-11 text-sm tabular-nums bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3"
        />
        <button
          onClick={run}
          disabled={running || !text.trim()}
          className="shrink-0 min-h-11 text-sm px-4 rounded-xl bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          {running ? "..." : "🧪 اجرا"}
        </button>
      </div>
      {result && (
        <div
          className={`text-xs leading-6 border rounded-xl p-3 mb-1 ${verdictTone}`}
        >
          <div className="font-medium mb-1">
            verdict: {result.verdict}
          </div>
          <div className="mb-1.5">{result.reason}</div>
          {result.debug && result.debug.llmRaw.length > 0 && (
            <div className="mt-1 pt-1 border-t border-current/30">
              <div className="text-xs opacity-80 mb-0.5">
                LLM گفت match (قبل از validator):
              </div>
              {result.debug.llmRaw.map((m, i) => (
                <div
                  key={i}
                  className="text-xs opacity-90 break-words"
                >
                  • alias=<b>{m.matchedAlias ?? "—"}</b> · quote=«{m.quote}» ·{" "}
                  {m.reason}
                </div>
              ))}
            </div>
          )}
          {result.debug && result.debug.droppedByValidator.length > 0 && (
            <div className="mt-1 pt-1 border-t border-current/30">
              <div className="text-xs opacity-80 mb-0.5">
                validator رد کرد (alias یا concept به‌صورت whole-word توی
                متن نیست):
              </div>
              {result.debug.droppedByValidator.map((m, i) => (
                <div key={i} className="text-xs opacity-90 break-words">
                  • «{m.quote}»
                </div>
              ))}
              <div className="text-xs opacity-80 mt-1">
                راه‌حل: یه alias دقیق‌تر اضافه کن که واقعاً توی پیام بیاد
                (مثلاً «{concept}»‌ی که توی پیام دیدی رو دقیقاً copy کن).
              </div>
            </div>
          )}
          {result.gates && (
            <details className="mt-1.5 text-xs opacity-80">
              <summary className="cursor-pointer min-h-10 flex items-center justify-center">جزئیات gate ها</summary>
              <pre dir="ltr" className="text-xs mt-1 overflow-x-auto text-start">
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
          setMsg(`${fa(extracted.length)} alias پیدا شد ولی همه از قبل بودن.`);
        } else {
          setMsg(`✅ ${fa(added.length)} alias اضافه شد: ${added.join("، ")}`);
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
    <div className="flex flex-col gap-2 w-full min-w-0">
      <div className="flex">
        <button
          type="button"
          onClick={run}
          disabled={busy || disabled}
          title={
            disabled
              ? "اول یه توضیح برای این concept بنویس"
              : `${existingAliases.length} alias الان توی لیست هست`
          }
          className="min-h-10 text-xs px-3 rounded-xl border border-[var(--color-accent)] text-[var(--color-accent)] active:bg-[var(--color-accent)]/10 disabled:opacity-50"
        >
          {busy ? "..." : "🤖 استخراج alias از توضیح"}
        </button>
      </div>
      {msg && (
        <span role="status" className="text-xs leading-6 text-[var(--color-text-dim)] break-words">
          {msg}
        </span>
      )}
    </div>
  );
}
