"use client";

import { useState } from "react";
import { truncate } from "@/lib/format";
import { btnAmber, btnGhost, fa, inputCls, type Example } from "./shared";

// Staged example editor: adds/removals are collected LOCALLY and only
// committed on 💾 ذخیره — nothing auto-applies. AI generation previews
// into the pending list for review before saving.
export default function ExampleEditor({
  ruleId,
  items,
  purpose,
  tone,
  placeholder,
  aiGenerate,
  onSaved,
}: {
  ruleId: number;
  items: Example[];
  purpose: "rule_match" | "negative_match";
  tone: "pos" | "neg";
  placeholder: string;
  aiGenerate?: boolean;
  onSaved: () => void;
}) {
  const [adds, setAdds] = useState<string[]>([]);
  const [dels, setDels] = useState<Set<number>>(new Set());
  const [draft, setDraft] = useState("");
  const [seed, setSeed] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = adds.length > 0 || dels.size > 0;
  const accent = tone === "neg" ? "bg-rose-600" : "bg-[var(--color-accent)]";
  const chipBg =
    tone === "neg"
      ? "bg-rose-500/5 border-rose-500/20"
      : "bg-[var(--color-surface-2)] border-transparent";

  const addDraft = () => {
    const t = draft.trim();
    if (!t) return;
    setAdds((a) => [...a, t]);
    setDraft("");
  };
  const toggleDel = (exId: number) =>
    setDels((d) => {
      const n = new Set(d);
      if (n.has(exId)) n.delete(exId);
      else n.add(exId);
      return n;
    });
  const aiGen = async () => {
    if (!seed.trim()) return;
    setAiBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/rules/${ruleId}/generate-examples`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample: seed, save: false }),
      });
      const j = (await r.json()) as { variations?: string[]; error?: string };
      if (r.ok && j.variations?.length) {
        setAdds((a) => [...a, ...j.variations!]);
        setSeed("");
        setMsg(`✅ ${j.variations.length} نمونه ساخته شد — بازبینی کن، بعد ذخیره بزن`);
      } else setMsg(`❌ ${j.error ?? "خطا"}`);
    } finally {
      setAiBusy(false);
      setTimeout(() => setMsg(null), 8000);
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      for (const text of adds)
        await fetch(`/api/rules/${ruleId}/examples`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, purpose }),
        });
      for (const exId of dels)
        await fetch(`/api/rules/${ruleId}/examples?exampleId=${exId}`, {
          method: "DELETE",
        });
      setAdds([]);
      setDels(new Set());
      onSaved();
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    setAdds([]);
    setDels(new Set());
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-3">
      {(items.length > 0 || adds.length > 0) && (
        <div className="flex flex-col gap-2">
          {items.map((e) => {
            const marked = dels.has(e.id);
            return (
              <div
                key={e.id}
                className={`flex items-center gap-2 ps-3 pe-1 py-1 min-h-14 rounded-xl border text-xs ${chipBg} ${marked ? "opacity-50" : ""}`}
              >
                {/* text-start: a sample message is data, centred lines are unreadable */}
                <div
                  dir="auto"
                  style={{ unicodeBidi: "plaintext" }}
                  className={`flex-1 min-w-0 whitespace-pre-wrap break-words text-start leading-6 py-1.5 ${marked ? "line-through" : ""}`}
                >
                  {truncate(e.text, 400)}
                </div>
                <button
                  onClick={() => toggleDel(e.id)}
                  title={marked ? "برگردون" : "برای حذف علامت بزن"}
                  aria-label={marked ? "برگردون" : "علامت حذف"}
                  className="grid place-items-center w-10 h-10 rounded-lg text-sm text-red-300 hover:text-red-200 shrink-0"
                >
                  {marked ? "↩︎" : "✕"}
                </button>
              </div>
            );
          })}
          {adds.map((t, i) => (
            <div
              key={`add-${i}`}
              className="flex items-center gap-2 ps-3 pe-1 py-1 min-h-14 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-xs"
            >
              <span className="text-xs text-emerald-300 shrink-0">جدید</span>
              <div dir="auto" style={{ unicodeBidi: "plaintext" }} className="flex-1 min-w-0 whitespace-pre-wrap break-words text-start leading-6 py-1.5">
                {truncate(t, 400)}
              </div>
              <button
                onClick={() => setAdds((a) => a.filter((_, j) => j !== i))}
                aria-label="حذف از لیست"
                className="grid place-items-center w-10 h-10 rounded-lg text-sm text-red-300 hover:text-red-200 shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className={inputCls}
        />
        <div className="flex gap-2">
          <button onClick={addDraft} disabled={!draft.trim()} className={btnGhost}>
            + به لیست
          </button>
        </div>
      </div>

      {aiGenerate && (
        <div className="flex flex-col gap-2">
          <input
            dir="auto"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="🤖 یه نمونه بده تا چندتای مشابه بسازه…"
            className={inputCls}
          />
          <div className="flex gap-2">
            <button onClick={aiGen} disabled={aiBusy || !seed.trim()} className={btnAmber}>
              {aiBusy ? "..." : "🤖 بساز"}
            </button>
          </div>
        </div>
      )}
      {msg && <div className="text-xs leading-6 text-[var(--color-text-dim)]">{msg}</div>}

      {dirty && (
        <div className="text-xs text-amber-300">
          {adds.length ? `${fa(adds.length)} افزودن` : ""}
          {adds.length && dels.size ? " · " : ""}
          {dels.size ? `${fa(dels.size)} حذف` : ""} — ذخیره نشده
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={save} disabled={!dirty || saving} className={`min-h-11 px-4 rounded-xl text-sm font-medium text-white disabled:opacity-40 ${accent}`}>
          {saving ? "ذخیره…" : "💾 ذخیره"}
        </button>
        {dirty && (
          <button onClick={discard} className={btnGhost}>
            انصراف
          </button>
        )}
      </div>
    </div>
  );
}
