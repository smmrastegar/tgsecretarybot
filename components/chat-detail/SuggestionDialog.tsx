"use client";

import { btnCls, btnPrimaryCls } from "./shared";
import { RELATIONSHIP_LABELS, type Suggestion } from "./types";

// The AI's proposed name / relationship / tone for this chat, shown as a bottom sheet (centred on desktop).
export default function SuggestionDialog({ suggestion, onClose, onApply }: { suggestion: Suggestion; onClose: () => void; onApply: () => void }) {
  const fields: Array<[string, string | null]> = [
    ["نام", suggestion.firstName],
    ["نام خانوادگی", suggestion.lastName],
    ["اسم خودمونی", suggestion.nickname],
    ["رابطه", suggestion.relationship ? RELATIONSHIP_LABELS[suggestion.relationship as keyof typeof RELATIONSHIP_LABELS] ?? suggestion.relationship : null],
  ];
  const cell = "p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40";
  return (
    <div className="fixed inset-0 z-[90] flex items-end md:items-center justify-center bg-black/60" onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-3xl md:rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 pb-6 text-center shadow-2xl">
        <h2 className="text-base font-semibold mb-2">🤖 پیشنهاد AI برای این چت</h2>
        <p className="text-sm leading-7 text-[var(--color-text-dim)] mb-4" dir="auto">{suggestion.reasoning}</p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {fields.map(([label, val]) => (
            <div key={label} className={cell}>
              <div className="text-xs text-[var(--color-text-dim)]">{label}</div>
              <div className="text-sm mt-0.5 [overflow-wrap:anywhere]" dir="auto">{val ?? <span className="opacity-50">—</span>}</div>
            </div>
          ))}
        </div>
        {(suggestion.relationshipNotes || suggestion.talkStyleNotes) && (
          <div className="flex flex-col gap-2 mb-3">
            {suggestion.relationshipNotes && (
              <div className={cell}>
                <div className="text-xs text-[var(--color-text-dim)] mb-0.5">شرح رابطه</div>
                <div className="text-sm leading-6" dir="auto">{suggestion.relationshipNotes}</div>
              </div>
            )}
            {suggestion.talkStyleNotes && (
              <div className={cell}>
                <div className="text-xs text-[var(--color-text-dim)] mb-0.5">لحن صحبت</div>
                <div className="text-sm leading-6" dir="auto">{suggestion.talkStyleNotes}</div>
              </div>
            )}
          </div>
        )}
        <div className="mt-4 flex gap-2 [justify-content:left]">
          <button type="button" onClick={onApply} className={btnPrimaryCls}>✅ اعمال کن</button>
          <button type="button" onClick={onClose} className={btnCls}>رد کن</button>
        </div>
      </div>
    </div>
  );
}
