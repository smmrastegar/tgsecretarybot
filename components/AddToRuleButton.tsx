"use client";

import { useCallback, useEffect, useState } from "react";

type Rule = { id: number; name: string };

// Tiny button that lets the operator turn any logged message into
// either a brand-new rule (with its body as the first example) or
// adds it as an example to one of the existing rules. Rendered next
// to other message actions on /messages and /chats/[id].
export default function AddToRuleButton({ messageLogId }: { messageLogId: number }) {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [mode, setMode] = useState<"add" | "create">("create");
  const [pickedRule, setPickedRule] = useState<number | "">("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [suggested, setSuggested] = useState<"none" | "ok" | "fail">("none");
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/rules")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { rules?: Rule[] } | null) => {
        if (j?.rules) setRules(j.rules);
      })
      .catch(() => {});
  }, [open]);

  // First time the operator opens the panel in "create" mode, fetch
  // an AI-suggested name + description for this message. The fields
  // stay editable; the suggestion only fills the blanks (we don't
  // overwrite anything the user already typed).
  useEffect(() => {
    if (!open || mode !== "create" || suggested !== "none") return;
    setSuggesting(true);
    fetch("/api/rules/suggest-from-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageLogId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          j: {
            ok?: boolean;
            name?: string;
            description?: string;
            error?: string | null;
          } | null,
        ) => {
          if (!j || !j.ok || (!j.name?.trim() && !j.description?.trim())) {
            setSuggested("fail");
            return;
          }
          setName((n) => (n.trim() ? n : j.name ?? ""));
          setDesc((d) => (d.trim() ? d : j.description ?? ""));
          setSuggested("ok");
        },
      )
      .catch(() => setSuggested("fail"))
      .finally(() => setSuggesting(false));
  }, [open, mode, messageLogId, suggested]);

  const submit = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const body: Record<string, unknown> = {
        messageLogId,
        action: mode,
      };
      if (mode === "create") {
        if (!name.trim() || !desc.trim()) {
          setStatus("اسم و توصیف لازمه");
          setBusy(false);
          return;
        }
        body.name = name;
        body.description = desc;
      } else {
        if (!pickedRule) {
          setStatus("یه rule انتخاب کن");
          setBusy(false);
          return;
        }
        body.ruleId = Number(pickedRule);
      }
      const r = await fetch("/api/rules/from-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        setStatus("✅ اضافه شد");
        setTimeout(() => setOpen(false), 1200);
      } else {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setStatus(j.error ?? `خطا ${r.status}`);
      }
    } finally {
      setBusy(false);
    }
  }, [messageLogId, mode, name, desc, pickedRule]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[10px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] text-[var(--color-text-dim)]"
        title="این پیام رو به یه rule اضافه کن یا یه rule جدید با این به‌عنوان مثال بساز"
      >
        📐 به rule
      </button>
    );
  }

  return (
    <div className="w-full mt-2 p-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-medium">📐 افزودن به rule</div>
        <button
          onClick={() => setOpen(false)}
          className="text-[10px] text-[var(--color-text-dim)] hover:text-white"
        >
          ✕
        </button>
      </div>
      <div className="flex gap-2 mb-2">
        <label className="flex items-center gap-1 text-[10px] cursor-pointer">
          <input
            type="radio"
            checked={mode === "create"}
            onChange={() => setMode("create")}
          />
          rule جدید
        </label>
        <label className="flex items-center gap-1 text-[10px] cursor-pointer">
          <input
            type="radio"
            checked={mode === "add"}
            onChange={() => setMode("add")}
          />
          اضافه به rule موجود
        </label>
      </div>
      {mode === "create" ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[10px] text-[var(--color-text-dim)]">
            <span>
              {suggesting
                ? "⏳ پیشنهاد AI…"
                : suggested === "ok"
                  ? "✨ AI پیشنهاد داد — اگه خواستی ویرایش کن"
                  : suggested === "fail"
                    ? "⚠ AI نتونست پیشنهاد بده — دستی تایپ کن"
                    : ""}
            </span>
            {suggested !== "none" && (
              <button
                type="button"
                onClick={() => {
                  setSuggested("none");
                  setName("");
                  setDesc("");
                }}
                className="text-[10px] underline-offset-2 hover:underline"
              >
                دوباره پیشنهاد بده
              </button>
            )}
          </div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={suggesting ? "…" : "اسم rule"}
            className="text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-2 py-1"
          />
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder={
              suggesting ? "…" : "توصیف: چه مدل پیام‌هایی match کنن؟"
            }
            rows={2}
            className="text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-2 py-1"
          />
        </div>
      ) : (
        <select
          value={pickedRule}
          onChange={(e) => setPickedRule(e.target.value as "" | number)}
          className="w-full text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-2 py-1"
        >
          <option value="">— rule رو انتخاب کن —</option>
          {rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      )}
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={submit}
          disabled={busy}
          className="text-[11px] px-3 py-1 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          {busy ? "…" : mode === "create" ? "بساز" : "اضافه کن"}
        </button>
        {status && (
          <span className="text-[10px] text-[var(--color-text-dim)]">
            {status}
          </span>
        )}
      </div>
    </div>
  );
}
