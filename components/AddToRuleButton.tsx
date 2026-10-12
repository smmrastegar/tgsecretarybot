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

  const field =
    "w-full min-h-11 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-3";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full min-h-11 px-3 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-dim)] active:bg-[var(--color-surface-2)]"
        title="این پیام رو به یه rule اضافه کن یا یه rule جدید با این به‌عنوان مثال بساز"
      >
        📐 به rule
      </button>
    );
  }

  return (
    <div className="w-full p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]">
      <div className="flex items-center justify-between mb-2.5">
        <span aria-hidden className="w-10" />
        <div className="text-sm font-medium">📐 افزودن به rule</div>
        <button
          onClick={() => setOpen(false)}
          aria-label="بستن"
          className="w-10 min-h-10 rounded-xl text-[var(--color-text-dim)] active:bg-[var(--color-surface)]"
        >
          ✕
        </button>
      </div>
      <div role="tablist" className="grid grid-cols-2 gap-2 mb-3">
        {(
          [
            ["create", "rule جدید"],
            ["add", "اضافه به rule موجود"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={`min-h-11 px-2 rounded-xl text-xs border ${
              mode === value
                ? "bg-[var(--color-accent)] text-white border-transparent"
                : "border-[var(--color-border)] text-[var(--color-text-dim)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "create" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-dim)]">
            <span className="min-w-0 flex-1">
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
                className="shrink-0 min-h-10 px-2 rounded-lg text-xs underline underline-offset-2"
              >
                دوباره پیشنهاد بده
              </button>
            )}
          </div>
          <input
            type="text"
            dir="auto"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={suggesting ? "…" : "اسم rule"}
            className={field}
          />
          <textarea
            dir="auto"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder={
              suggesting ? "…" : "توصیف: چه مدل پیام‌هایی match کنن؟"
            }
            rows={3}
            className={`${field} py-2 leading-7`}
          />
        </div>
      ) : (
        <select
          value={pickedRule}
          onChange={(e) => setPickedRule(e.target.value as "" | number)}
          className={field}
        >
          <option value="">— rule رو انتخاب کن —</option>
          {rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      )}
      <button
        onClick={submit}
        disabled={busy}
        className="mt-3 w-full min-h-11 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium disabled:opacity-50"
      >
        {busy ? "…" : mode === "create" ? "بساز" : "اضافه کن"}
      </button>
      {status && (
        <div role="status" className="mt-2 text-xs text-[var(--color-text-dim)]">
          {status}
        </div>
      )}
    </div>
  );
}
