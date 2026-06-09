"use client";

import { useState } from "react";
import AddToRuleButton from "./AddToRuleButton";
import { Badge } from "@/components/Card";

type Secretary = { userId: number; name: string };

type ChatMode =
  | "off"
  | "secretary"
  | "auto_reply"
  | "friendly_reply"
  | "ai_chat"
  | "ai_listen";

const MODE_LABEL: Record<
  ChatMode,
  { label: string; tone: "success" | "warn" | "info" | "neutral" }
> = {
  off: { label: "Off", tone: "neutral" },
  secretary: { label: "Secretary", tone: "warn" },
  auto_reply: { label: "Auto-reply", tone: "info" },
  friendly_reply: { label: "Friendly AI", tone: "info" },
  ai_chat: { label: "AI chat", tone: "success" },
  ai_listen: { label: "AI listen", tone: "info" },
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
  const [toast, setToast] = useState<string | null>(null);

  function showToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(null), 3500);
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
      alert(err instanceof Error ? err.message : String(err));
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
      const r = await fetch(`/api/messages/${m.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, markHandled: true, setMode: "ai_chat" }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setDraft(null);
      showToast("✅ Sent — AI will handle this chat from now on");
      onChange?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
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
      showToast(`↗ Forwarded to ${j.secretary?.name ?? "secretary"}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
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
          ? `🤖 AI replied: ${preview}${(j.reply ?? "").length > 140 ? "…" : ""}`
          : "🤖 AI handled this chat. Future messages will get AI replies too.",
      );
      onChange?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
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
      alert(err instanceof Error ? err.message : String(err));
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
        showToast("🧠 Nothing actionable found in this message.");
      } else {
        const first = j.items?.[0]?.title;
        showToast(
          `🧠 Saved ${j.saved} item${j.saved === 1 ? "" : "s"}${first ? `: ${first}` : ""} → Reminders`,
        );
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
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
    <>
      {toast && (
        <div className="mt-2 p-2 rounded-md bg-emerald-900/40 border border-emerald-800 text-emerald-200 text-xs">
          {toast}
        </div>
      )}

      <div className="mt-2 flex gap-1.5 flex-wrap items-center justify-center">
        {m.chatMode && (
          <Badge tone={MODE_LABEL[m.chatMode].tone}>
            mode: {MODE_LABEL[m.chatMode].label}
          </Badge>
        )}
        {canTranscribe(m.mediaKind) && !m.transcript && (
          <button
            onClick={transcribe}
            disabled={transcribing}
            className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            {transcribing ? "Transcribing…" : "🎙 Transcribe"}
          </button>
        )}
        <button
          onClick={extract}
          disabled={extracting}
          className="text-[11px] px-2 py-1 rounded-md border border-purple-700 text-purple-300 hover:bg-purple-900/30 disabled:opacity-50"
        >
          {extracting ? "Extracting…" : "🧠 Extract"}
        </button>
        {!m.handledAt && draft === null && (
          <button
            onClick={suggest}
            disabled={suggesting}
            className="text-[11px] px-2 py-1 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {suggesting ? "…" : "🤖 AI suggest"}
          </button>
        )}
        {!m.handledAt && m.chatMode === "ai_chat" ? (
          <span className="text-[11px] px-2 py-1 rounded-md border border-emerald-700 bg-emerald-900/30 text-emerald-300">
            ✓ AI handling
          </span>
        ) : (
          !m.handledAt && (
            <button
              onClick={handOverToAi}
              disabled={handing}
              className="text-[11px] px-2 py-1 rounded-md border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-50"
            >
              {handing ? "…" : "🤖 Full AI"}
            </button>
          )
        )}
        {!m.handledAt && secretaries.length > 0 && (
          <select
            defaultValue=""
            disabled={forwarding}
            onChange={(e) => {
              const v = Number(e.target.value);
              e.currentTarget.value = "";
              if (Number.isFinite(v) && v > 0) forwardTo(v);
            }}
            className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
          >
            <option value="" disabled>
              {forwarding ? "…" : "↗ Forward to…"}
            </option>
            {secretaries.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {m.handledAt ? (
          <button
            onClick={() => setHandled(false)}
            className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
          >
            Unhandle
          </button>
        ) : (
          <button
            onClick={() => setHandled(true)}
            className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
          >
            Mark handled
          </button>
        )}
        {m.handledAt && <Badge tone="success">handled</Badge>}
        <AddToRuleButton messageLogId={m.id} />
      </div>

      {draft !== null && (
        <div className="mt-2 p-2 rounded-md bg-[var(--color-surface-2)]">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-1">
            AI suggested reply (you can edit)
          </div>
          <textarea
            dir="auto"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1.5 text-sm"
          />
          <div className="mt-2 flex gap-2 flex-wrap">
            <button
              onClick={sendReply}
              disabled={sending || !draft.trim()}
              className="text-xs px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
            >
              {sending ? "Sending…" : "✅ Send as me"}
            </button>
            <button
              onClick={suggest}
              disabled={suggesting}
              className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              {suggesting ? "…" : "🔁 Regenerate"}
            </button>
            <button
              onClick={() => setDraft(null)}
              className="text-xs px-3 py-1.5 rounded-md text-[var(--color-text-dim)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
