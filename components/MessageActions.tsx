"use client";

import { useState } from "react";
import AddToRuleButton from "./AddToRuleButton";
import Chip, { type ChipTone } from "@/components/dash/Chip";

type Secretary = { userId: number; name: string };

type ChatMode =
  | "off"
  | "secretary"
  | "auto_reply"
  | "friendly_reply"
  | "ai_chat"
  | "ai_listen";

const MODE_LABEL: Record<ChatMode, { label: string; tone: ChipTone }> = {
  off: { label: "خاموش", tone: "neutral" },
  secretary: { label: "منشی", tone: "warn" },
  auto_reply: { label: "پاسخ خودکار", tone: "info" },
  friendly_reply: { label: "AI دوستانه", tone: "info" },
  ai_chat: { label: "گفتگوی AI", tone: "ok" },
  ai_listen: { label: "شنود AI", tone: "info" },
};

type MessageLike = {
  id: number;
  chatId: number;
  chatType: string;
  mediaKind: string | null;
  transcript: string | null;
  handledAt: string | null;
  chatMode?: ChatMode;
};

type Props = {
  message: MessageLike;
  secretaries: Secretary[];
  /** Called after any action that mutated the message so the parent can refresh. */
  onChange?: () => void;
  /** Called locally when a transcript arrives so the parent can update its row. */
  onTranscript?: (id: number, text: string) => void;
};

// Secondary button: 44px, outlined.
const BTN =
  "min-h-11 px-3 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] disabled:opacity-50";

function canTranscribe(kind: string | null): boolean {
  return (
    kind === "voice" || kind === "audio" || kind === "video_note" || kind === "video"
  );
}

export default function MessageActions({
  message: m,
  secretaries,
  onChange,
  onTranscript,
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [handing, setHanding] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [toast, setToast] = useState<{ text: string; err: boolean } | null>(null);
  // Rarely used actions stay folded behind "اقدام‌های بیشتر" so a card keeps one clear primary action.
  const [more, setMore] = useState(false);

  // Status line under the card (green = done, red = failed; errors stay longer).
  function showToast(text: string, err = false) {
    setToast({ text, err });
    setTimeout(() => setToast(null), err ? 6000 : 3500);
  }

  async function suggest() {
    setSuggesting(true);
    try {
      const r = await fetch(`/api/messages/${m.id}/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await r.json()) as { suggestion?: string; error?: string };
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setDraft(j.suggestion ?? "");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), true);
    } finally {
      setSuggesting(false);
    }
  }

  async function sendReply() {
    if (draft === null) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      // Sending ONE reply must not change the chat's mode. Handing a chat to the AI is a separate, explicit
      // decision (the «کامل با AI» button) — never a side effect of pressing send.
      const r = await fetch(`/api/messages/${m.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, markHandled: true }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setDraft(null);
      showToast("✅ ارسال شد");
      onChange?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), true);
    } finally {
      setSending(false);
    }
  }

  async function forwardTo(secretaryUserId: number) {
    setForwarding(true);
    try {
      const r = await fetch(`/api/messages/${m.id}/forward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secretaryUserId }),
      });
      const j = (await r.json()) as {
        error?: string;
        secretary?: { name: string };
      };
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      showToast(`↗ فوروارد شد به ${j.secretary?.name ?? "منشی"}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), true);
    } finally {
      setForwarding(false);
    }
  }

  async function handOverToAi() {
    setHanding(true);
    try {
      const r = await fetch(`/api/messages/${m.id}/ai-handle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await r.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
      };
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      const preview = (j.reply ?? "").slice(0, 140);
      showToast(
        preview
          ? `🤖 AI پاسخ داد: ${preview}${(j.reply ?? "").length > 140 ? "…" : ""}`
          : "🤖 AI این چت رو مدیریت کرد. پیام‌های بعدی هم پاسخ AI می‌گیرن.",
      );
      onChange?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), true);
    } finally {
      setHanding(false);
    }
  }

  async function transcribe() {
    setTranscribing(true);
    try {
      const r = await fetch(`/api/messages/${m.id}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await r.json()) as { transcript?: string; error?: string };
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      onTranscript?.(m.id, j.transcript ?? "");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), true);
    } finally {
      setTranscribing(false);
    }
  }

  async function extract() {
    setExtracting(true);
    try {
      const r = await fetch(`/api/messages/${m.id}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await r.json()) as {
        saved?: number;
        items?: Array<{ title: string }>;
        error?: string;
      };
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      if (!j.saved) {
        showToast("🧠 چیز قابل‌اقدامی توی این پیام پیدا نشد.");
      } else {
        const first = j.items?.[0]?.title;
        showToast(
          `🧠 ${j.saved} مورد ذخیره شد${first ? `: ${first}` : ""} ← یادآوری‌ها`,
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), true);
    } finally {
      setExtracting(false);
    }
  }

  async function setHandled(handled: boolean) {
    await fetch(`/api/messages/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handled }),
    });
    onChange?.();
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {toast && (
        <div
          role="status"
          className={`rounded-xl border px-3 py-2.5 text-xs leading-6 ${
            toast.err
              ? "bg-rose-900/30 border-rose-800 text-rose-200"
              : "bg-emerald-900/40 border-emerald-800 text-emerald-200"
          }`}
        >
          {toast.text}
        </div>
      )}

      {(m.chatMode || m.handledAt) && (
        <div className="flex gap-1.5 flex-wrap items-center justify-center">
          {m.chatMode && (
            <Chip tone={MODE_LABEL[m.chatMode].tone}>
              حالت: {MODE_LABEL[m.chatMode].label}
            </Chip>
          )}
          {m.handledAt && <Chip tone="ok">رسیدگی‌شده</Chip>}
        </div>
      )}

      {!m.handledAt && draft === null && (
        <button
          onClick={suggest}
          disabled={suggesting}
          className="w-full min-h-11 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium active:opacity-80 disabled:opacity-50"
        >
          {suggesting ? "در حال پیشنهاد…" : "🤖 پیشنهاد AI"}
        </button>
      )}

      <div className="grid grid-cols-2 gap-2">
        {m.handledAt ? (
          <button onClick={() => setHandled(false)} className={BTN}>
            برگردون به نرسیدگی
          </button>
        ) : (
          <button
            onClick={() => setHandled(true)}
            className="min-h-11 px-3 rounded-xl border border-emerald-700 text-emerald-300 text-sm active:bg-emerald-900/30"
          >
            ✓ رسیدگی شد
          </button>
        )}
        <button
          onClick={() => setMore((o) => !o)}
          aria-expanded={more}
          className={BTN}
        >
          {more ? "بستن ▴" : "اقدام‌های بیشتر ▾"}
        </button>
      </div>

      {more && (
        <div className="grid grid-cols-2 gap-2">
          {canTranscribe(m.mediaKind) && !m.transcript && (
            <button onClick={transcribe} disabled={transcribing} className={BTN}>
              {transcribing ? "در حال پیاده‌سازی…" : "🎙 پیاده‌سازی متن"}
            </button>
          )}
          <button
            onClick={extract}
            disabled={extracting}
            className="min-h-11 px-3 rounded-xl border border-purple-700 text-purple-300 text-sm active:bg-purple-900/30 disabled:opacity-50"
          >
            {extracting ? "در حال استخراج…" : "🧠 استخراج"}
          </button>
          {!m.handledAt &&
            (m.chatMode === "ai_chat" ? (
              <span className="min-h-11 grid place-items-center rounded-xl border border-emerald-700 bg-emerald-900/30 text-sm text-emerald-300">
                ✓ مدیریت با AI
              </span>
            ) : (
              <button
                onClick={handOverToAi}
                disabled={handing}
                className="min-h-11 px-3 rounded-xl border border-emerald-700 text-emerald-300 text-sm active:bg-emerald-900/30 disabled:opacity-50"
              >
                {handing ? "…" : "🤖 کامل با AI"}
              </button>
            ))}
          {!m.handledAt && secretaries.length > 0 && (
            <select
              defaultValue=""
              disabled={forwarding}
              aria-label="فوروارد به منشی"
              onChange={(e) => {
                const v = Number(e.target.value);
                e.currentTarget.value = "";
                if (Number.isFinite(v) && v > 0) forwardTo(v);
              }}
              className="min-h-11 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            >
              <option value="" disabled>
                {forwarding ? "…" : "↗ فوروارد به…"}
              </option>
              {secretaries.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <div className="col-span-2">
            <AddToRuleButton messageLogId={m.id} />
          </div>
        </div>
      )}

      {draft !== null && (
        <div className="p-2.5 rounded-xl bg-[var(--color-surface-2)]">
          <div className="text-xs text-[var(--color-text-dim)] mb-1.5">
            پاسخ پیشنهادی AI (می‌تونی ویرایش کنی)
          </div>
          <textarea
            dir="auto"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            aria-label="پاسخ پیشنهادی"
            className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl px-3 py-2 text-sm leading-7"
          />
          <button
            onClick={sendReply}
            disabled={sending || !draft.trim()}
            className="mt-2 w-full min-h-11 rounded-xl bg-emerald-700 active:bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
          >
            {sending ? "در حال ارسال…" : "✅ ارسال از طرف من"}
          </button>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button onClick={suggest} disabled={suggesting} className={BTN}>
              {suggesting ? "…" : "🔁 تولید مجدد"}
            </button>
            <button onClick={() => setDraft(null)} className={`${BTN} text-[var(--color-text-dim)]`}>
              انصراف
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
