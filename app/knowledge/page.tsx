"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/Dialogs";
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

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

const BTN = "min-h-11 px-4 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-[var(--color-accent)] text-white`;
const BTN_PLAIN = `${BTN} border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]`;
// Action row: buttons sit on the physical left.
const ACTIONS = "flex flex-wrap gap-2 w-full justify-[left]";
const FIELD = "w-full min-h-11 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 text-sm mb-4";

function parseCsv(s: string): string[] {
  return s
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export default function KnowledgePage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const r = await fetch("/api/knowledge");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { entries: Entry[] };
      setEntries(j.entries ?? []);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
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
    if (!(await confirmDialog("این entry حذف بشه؟", { danger: true, confirmLabel: "حذف" }))) return;
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
        title="دانش‌نامه"
        subtitle="اصطلاحات، نام‌ها، توضیحات. هر چیزی که اینجا بنویسی، وقتی توی پیام دیده بشه به AI تزریق می‌شه."
        actions={
          <div className={ACTIONS}>
            <button onClick={startNew} className={BTN_PRIMARY}>
              + افزودن مورد
            </button>
          </div>
        }
      />

      <input
        dir="auto"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="جستجو"
        placeholder="🔍 جستجو در عنوان، متن و برچسب‌ها…"
        className="w-full min-h-11 mb-2 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4"
      />
      {entries.length > 0 && (
        <div className="mb-3 text-xs text-center text-[var(--color-text-dim)]">
          {search.trim() ? `${fa(filtered.length)} از ${fa(entries.length)} مورد` : `${fa(entries.length)} مورد`}
        </div>
      )}

      {loadErr ? (
        <Card>
          <p className="text-sm text-red-300">خطا در بارگذاری دانش‌نامه: {loadErr}</p>
          <div className="mt-3 flex">
            <button onClick={() => void load()} className={BTN_PRIMARY}>تلاش دوباره</button>
          </div>
        </Card>
      ) : loading && entries.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</p>
        </Card>
      ) : filtered.length === 0 ? (
        entries.length === 0 ? (
          <EmptyState
            icon="📚"
            title="هنوز چیزی اضافه نکردی."
            hint="اولین entry رو با دکمه‌ی «+ افزودن مورد» بساز."
            action={<button onClick={startNew} className={BTN_PRIMARY}>+ افزودن مورد</button>}
          />
        ) : (
          <EmptyState icon="🔍" title="هیچ entry با این جستجو match نشد." />
        )
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((e) => (
            <Card key={e.id}>
              <div className="font-semibold text-base leading-7" dir="auto">
                {e.title}
              </div>
              {e.aliases.length > 0 && (
                <div className="text-xs text-[var(--color-text-dim)] mt-0.5 leading-5" dir="auto">
                  معروف به: {e.aliases.join(" · ")}
                </div>
              )}
              <div
                dir="auto"
                className="text-sm leading-7 mt-3 whitespace-pre-wrap break-words"
              >
                {e.body}
              </div>
              {e.tags.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1.5 mt-3">
                  {e.tags.map((t) => (
                    <span key={t} dir="auto" className="inline-flex items-center px-2.5 py-1 rounded-full text-xs bg-blue-500/15 text-blue-300">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 text-xs text-[var(--color-text-dim)]">
                آخرین ویرایش: {relTime(e.updatedAt)}
              </div>
              <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex gap-2">
                <button onClick={() => startEdit(e)} className={BTN_PLAIN}>
                  ✎ ویرایش
                </button>
                <button
                  onClick={() => void remove(e.id)}
                  className={`${BTN} border border-rose-500/40 text-rose-200 hover:bg-rose-500/10`}
                >
                  🗑 حذف
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {draft && (
        // Bottom sheet on phones, centred dialog on desktop. Form labels stay start-aligned (a form, not card
        // content), so they sit right above the field they describe.
        <div
          className="fixed inset-0 bg-black/60 flex items-end md:items-center justify-center z-50 md:p-4"
          onClick={() => setDraft(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl md:rounded-2xl p-5 pb-6 w-full max-w-lg max-h-[92dvh] overflow-y-auto"
          >
            <h2 className="text-base font-semibold mb-4 text-center">
              {draft.id ? "ویرایش مورد" : "مورد جدید"}
            </h2>

            <label className="block text-sm text-[var(--color-text-dim)] mb-1.5">
              عنوان (اصطلاح / نام / مفهوم)
            </label>
            <input
              dir="auto"
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="مثلاً: پروژه‌ی آذر"
              className={FIELD}
            />

            <label className="block text-sm text-[var(--color-text-dim)] mb-1.5">
              نام‌های مستعار (CSV — هر اسم/سرنام دیگری که ممکنه باهاش بیاد)
            </label>
            <input
              dir="auto"
              type="text"
              value={draft.aliasesCsv}
              onChange={(e) =>
                setDraft({ ...draft, aliasesCsv: e.target.value })
              }
              placeholder="آذر, Azar, پ-آذر"
              className={FIELD}
            />

            <label className="block text-sm text-[var(--color-text-dim)] mb-1.5">
              متن (توضیح / تعریف / context — هر چقدر می‌خوای)
            </label>
            <textarea
              dir="auto"
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={6}
              placeholder="یه پروژه‌ی داخلی برای X. مدیر: Y. ددلاین: Z. هر وقت این اسم اومد یعنی…"
              className={`${FIELD} py-2.5`}
            />

            <label className="block text-sm text-[var(--color-text-dim)] mb-1.5">
              برچسب‌ها (CSV — اختیاری)
            </label>
            <input
              dir="auto"
              type="text"
              value={draft.tagsCsv}
              onChange={(e) => setDraft({ ...draft, tagsCsv: e.target.value })}
              placeholder="پروژه, کار, ۱۴۰۳"
              className={FIELD}
            />

            {msg && (
              <div className="text-sm text-amber-400 mb-3 text-center">{msg}</div>
            )}

            <div className="flex gap-2">
              <button onClick={save} disabled={saving} className={BTN_PRIMARY}>
                {saving ? "در حال ذخیره…" : "ذخیره"}
              </button>
              <button onClick={() => setDraft(null)} className={BTN_PLAIN}>
                لغو
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
