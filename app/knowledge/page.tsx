"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime } from "@/lib/format";

type Entry = {
  id: number;
  title: string;
  aliases: string[];
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

type Draft = {
  id?: number;
  title: string;
  aliasesCsv: string;
  body: string;
  tagsCsv: string;
};

const BLANK: Draft = { title: "", aliasesCsv: "", body: "", tagsCsv: "" };

function parseCsv(s: string): string[] {
  return s
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export default function KnowledgePage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/knowledge");
    const j = (await r.json()) as { entries: Entry[] };
    setEntries(j.entries ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startNew() {
    setDraft({ ...BLANK });
    setMsg(null);
  }

  function startEdit(e: Entry) {
    setDraft({
      id: e.id,
      title: e.title,
      aliasesCsv: e.aliases.join(", "),
      body: e.body,
      tagsCsv: e.tags.join(", "),
    });
    setMsg(null);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setMsg(null);
    const payload = {
      title: draft.title.trim(),
      aliases: parseCsv(draft.aliasesCsv),
      body: draft.body.trim(),
      tags: parseCsv(draft.tagsCsv),
    };
    if (!payload.title || !payload.body) {
      setMsg("title و body اجباری هستند.");
      setSaving(false);
      return;
    }
    const url = draft.id ? `/api/knowledge/${draft.id}` : "/api/knowledge";
    const method = draft.id ? "PUT" : "POST";
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      setMsg(j.error ?? `error ${r.status}`);
      return;
    }
    setDraft(null);
    await load();
  }

  async function remove(id: number) {
    if (!confirm("این entry حذف بشه؟")) return;
    await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
    await load();
  }

  const filtered = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      if (e.title.toLowerCase().includes(q)) return true;
      if (e.body.toLowerCase().includes(q)) return true;
      if (e.aliases.some((a) => a.toLowerCase().includes(q))) return true;
      if (e.tags.some((t) => t.toLowerCase().includes(q))) return true;
      return false;
    });
  })();

  return (
    <Shell>
      <PageTitle
        title="Knowledge base"
        subtitle="اصطلاحات، نام‌ها، توضیحات. هر چیزی که اینجا بنویسی، وقتی توی پیام دیده بشه به AI تزریق می‌شه."
        actions={
          <button
            onClick={startNew}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90"
          >
            + Add entry
          </button>
        }
      />

      <Card className="mb-4 !p-3">
        <input
          dir="auto"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="جستجو در title / body / aliases / tags…"
          className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm"
        />
      </Card>

      {loading ? (
        <Card>Loading…</Card>
      ) : filtered.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            {entries.length === 0
              ? "هنوز چیزی اضافه نکردی. اولین entry رو با دکمه‌ی + Add entry بساز."
              : "هیچ entry با این جستجو match نشد."}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((e) => (
            <Card key={e.id} className="!p-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm" dir="auto">
                    {e.title}
                  </div>
                  {e.aliases.length > 0 && (
                    <div className="text-[10px] text-[var(--color-text-dim)] mt-0.5">
                      aka: {e.aliases.join(" · ")}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[var(--color-text-dim)]">
                    {relTime(e.updatedAt)}
                  </span>
                  <button
                    onClick={() => startEdit(e)}
                    className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(e.id)}
                    className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-red-900/40"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div
                dir="auto"
                className="text-sm mt-2 whitespace-pre-wrap break-words"
              >
                {e.body}
              </div>
              {e.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {e.tags.map((t) => (
                    <Badge key={t} tone="info">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {draft && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setDraft(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 w-full max-w-lg"
          >
            <h2 className="text-base font-semibold mb-3">
              {draft.id ? "Edit entry" : "New entry"}
            </h2>

            <label className="block text-xs text-[var(--color-text-dim)] mb-1">
              Title (اصطلاح / نام / مفهوم)
            </label>
            <input
              dir="auto"
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="مثلاً: پروژه‌ی آذر"
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm mb-3"
            />

            <label className="block text-xs text-[var(--color-text-dim)] mb-1">
              Aliases (CSV — هر اسم/سرنام دیگری که ممکنه باهاش بیاد)
            </label>
            <input
              dir="auto"
              type="text"
              value={draft.aliasesCsv}
              onChange={(e) =>
                setDraft({ ...draft, aliasesCsv: e.target.value })
              }
              placeholder="آذر, Azar, پ-آذر"
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm mb-3"
            />

            <label className="block text-xs text-[var(--color-text-dim)] mb-1">
              Body (توضیح / تعریف / context — هر چقدر می‌خوای)
            </label>
            <textarea
              dir="auto"
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={6}
              placeholder="یه پروژه‌ی داخلی برای X. مدیر: Y. ددلاین: Z. هر وقت این اسم اومد یعنی…"
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm mb-3"
            />

            <label className="block text-xs text-[var(--color-text-dim)] mb-1">
              Tags (CSV — اختیاری)
            </label>
            <input
              dir="auto"
              type="text"
              value={draft.tagsCsv}
              onChange={(e) => setDraft({ ...draft, tagsCsv: e.target.value })}
              placeholder="پروژه, کار, ۱۴۰۳"
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm mb-4"
            />

            {msg && (
              <div className="text-xs text-amber-400 mb-3">{msg}</div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDraft(null)}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
