"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Badge, Card, PageTitle } from "@/components/Card";
import { relTime } from "@/lib/format";

type Alias = {
  id: number;
  itemId: number;
  alias: string;
  createdAt: string;
};

type Item = {
  id: number;
  concept: string;
  description: string | null;
  enabled: boolean;
  matchCount: number;
  lastMatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
  aliases: string[];
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

export default function NoteWatchlistPage() {
  const [items, setItems] = useState<Item[]>([]);
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
        const j = (await r.json()) as { items: Item[] };
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
    async (id: number, patch: Partial<Item>) => {
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
    <Shell>
      <PageTitle
        title="🕵️ Note Watchlist"
        subtitle="چند مفهوم تعریف کن — هر پیامی توی هر چتی که LLM تشخیص بده بهشون اشاره داره، اینجا ثبت می‌شه، توی Notes چت ذخیره می‌شه و برای کانال notes_inbox هم فوروارد می‌شه."
      />

      <Card className="mb-4">
        <div className="text-xs font-medium mb-2">+ مفهوم جدید</div>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={newConcept}
            onChange={(e) => setNewConcept(e.target.value)}
            placeholder="مفهوم (مثلاً «سفارش جدید»، «تأخیر پروازی»، «هشدار امنیتی»)"
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
                  onToggle={(v) => update(it.id, { enabled: v })}
                  onRename={(v) => update(it.id, { concept: v })}
                  onDescChange={(v) =>
                    update(it.id, { description: v || null })
                  }
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
                ·{" "}
                {items.find((i) => i.id === activeItemId)?.concept ?? "?"}
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
    </Shell>
  );
}

function ItemCard({
  item,
  active,
  onClick,
  onToggle,
  onRename,
  onDescChange,
  onDelete,
}: {
  item: Item;
  active: boolean;
  onClick: () => void;
  onToggle: (enabled: boolean) => void;
  onRename: (concept: string) => void;
  onDescChange: (description: string) => void;
  onDelete: () => void;
}) {
  return (
    <Card
      className={`!p-3 cursor-pointer transition-colors ${
        active ? "border-[var(--color-accent)]" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap mb-1.5">
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
          <input
            type="text"
            defaultValue={item.concept}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== item.concept) onRename(v);
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-sm font-medium bg-transparent border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none px-1 py-0.5 min-w-0 flex-1"
          />
          {item.enabled ? (
            <Badge tone="success">on</Badge>
          ) : (
            <Badge tone="neutral">off</Badge>
          )}
          {item.matchCount > 0 && (
            <Badge tone="info">{item.matchCount} match</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <label
            className="text-[10px] flex items-center gap-1 cursor-pointer"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={item.enabled}
              onChange={(e) => onToggle(e.target.checked)}
            />
            enabled
          </label>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
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
          if (v !== (item.description ?? "")) onDescChange(v);
        }}
        onClick={(e) => e.stopPropagation()}
        placeholder="توضیح اختیاری برای AI"
        rows={2}
        className="w-full text-[11px] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 mb-1.5"
      />
      <AliasEditor item={item} />
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

function AliasEditor({ item }: { item: Item }) {
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

  // Seed from the parent fetch when available so the chips render
  // immediately, then refresh from the dedicated endpoint to pick up
  // server-assigned IDs.
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
      // Stale seed row — refresh from server to find the real id.
      await load();
      return;
    }
    setAliases((cur) => cur.filter((a) => a.id !== aliasId));
    await fetch(`/api/note-watchlist/aliases/${aliasId}`, {
      method: "DELETE",
    });
  };

  return (
    <div
      className="mb-2 border-t border-[var(--color-border)] pt-2"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[10px] text-[var(--color-text-dim)] mb-1.5">
        راه‌های رسیدن به این مفهوم — هر چیزی که توی پیام می‌تونه این مفهوم رو
        بهت معنی کنه (اسامی، اصطلاحات، اسم لاتین، اسم کوتاه، ...).
      </div>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {!loaded && aliases.length === 0 && (
          <span className="text-[10px] text-[var(--color-text-dim)] italic">
            ...
          </span>
        )}
        {loaded && aliases.length === 0 && (
          <span className="text-[10px] text-[var(--color-text-dim)] italic">
            هنوز alias ای تعریف نشده — فقط روی خود «{item.concept}» match می‌شه.
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
