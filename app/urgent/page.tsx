"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { chatTypeLabel, relTime } from "@/lib/format";

type Message = {
  id: number;
  createdAt: string;
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  senderName: string;
  messageText: string;
  importance: number;
  reason: string;
  alerted: boolean;
  autoReplied: boolean;
  handledAt: string | null;
  mediaKind: string | null;
  transcript: string | null;
};

export default function UrgentPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHandled, setShowHandled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const url = `/api/messages?urgent=1${showHandled ? "" : "&unhandled=1"}`;
    const r = await fetch(url);
    const j = (await r.json()) as { messages: Message[] };
    setMessages(j.messages);
    setLoading(false);
  }, [showHandled]);

  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  async function setHandled(id: number, handled: boolean) {
    await fetch(`/api/messages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handled }),
    });
    load();
  }

  const [transcribing, setTranscribing] = useState<Set<number>>(new Set());
  const [suggesting, setSuggesting] = useState<Set<number>>(new Set());
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [sending, setSending] = useState<Set<number>>(new Set());
  const [forwarding, setForwarding] = useState<Set<number>>(new Set());
  const [secretaries, setSecretaries] = useState<
    { userId: number; name: string }[]
  >([]);

  useEffect(() => {
    fetch("/api/secretaries")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.secretaries && setSecretaries(d.secretaries))
      .catch(() => {});
  }, []);

  async function suggest(id: number) {
    setSuggesting((s) => new Set(s).add(id));
    try {
      const r = await fetch(`/api/messages/${id}/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await r.json()) as { suggestion?: string; error?: string };
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setDrafts((d) => ({ ...d, [id]: j.suggestion ?? "" }));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSuggesting((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function sendReply(id: number) {
    const text = (drafts[id] ?? "").trim();
    if (!text) return;
    setSending((s) => new Set(s).add(id));
    try {
      const r = await fetch(`/api/messages/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, markHandled: true }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setDrafts((d) => {
        const n = { ...d };
        delete n[id];
        return n;
      });
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSending((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function forwardTo(id: number, secretaryUserId: number) {
    setForwarding((s) => new Set(s).add(id));
    try {
      const r = await fetch(`/api/messages/${id}/forward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secretaryUserId }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setForwarding((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function transcribe(id: number) {
    setTranscribing((s) => new Set(s).add(id));
    try {
      const r = await fetch(`/api/messages/${id}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await r.json()) as { transcript?: string; error?: string };
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setMessages((ms) =>
        ms.map((m) =>
          m.id === id ? { ...m, transcript: j.transcript ?? "" } : m,
        ),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscribing((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }
  const canTranscribe = (kind: string | null) =>
    kind === "voice" || kind === "audio" || kind === "video_note" || kind === "video";

  return (
    <Shell>
      <PageTitle
        title="Urgent inbox"
        subtitle="Messages the AI flagged as urgent and concerning you."
        actions={
          <label className="text-xs text-[var(--color-text-dim)] flex items-center gap-2">
            <input
              type="checkbox"
              checked={showHandled}
              onChange={(e) => setShowHandled(e.target.checked)}
            />
            Show handled
          </label>
        }
      />

      {loading ? (
        <Card>Loading…</Card>
      ) : messages.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            Inbox zero. No urgent messages pending.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {messages.map((m) => (
            <Card key={m.id}>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-start sm:justify-between gap-3 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-[var(--color-text-dim)] mb-2 flex items-center gap-2 flex-wrap">
                    <span>{m.senderName}</span>
                    <span>·</span>
                    <span>{chatTypeLabel(m.chatType)}</span>
                    {m.chatTitle && (
                      <>
                        <span>·</span>
                        <span>{m.chatTitle}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{relTime(m.createdAt)}</span>
                  </div>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {m.messageText}
                  </div>
                  {m.transcript && (
                    <div className="mt-2 p-2 rounded-md bg-[var(--color-surface-2)] text-sm">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-1">
                        transcript
                      </div>
                      <div className="whitespace-pre-wrap break-words">
                        {m.transcript}
                      </div>
                    </div>
                  )}
                  <div className="text-xs text-[var(--color-text-dim)] mt-2 italic">
                    {m.reason}
                  </div>
                  <div className="mt-3 flex gap-2 flex-wrap items-center">
                    <Badge tone="danger">imp {m.importance}/10</Badge>
                    {m.alerted && <Badge tone="warn">alerted</Badge>}
                    {m.autoReplied && <Badge tone="info">auto-replied</Badge>}
                    {m.mediaKind && <Badge tone="neutral">{m.mediaKind}</Badge>}
                    {m.handledAt && <Badge tone="success">handled</Badge>}
                    {canTranscribe(m.mediaKind) && !m.transcript && (
                      <button
                        onClick={() => transcribe(m.id)}
                        disabled={transcribing.has(m.id)}
                        className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                      >
                        {transcribing.has(m.id) ? "Transcribing…" : "🎙 Transcribe"}
                      </button>
                    )}
                  </div>

                  {drafts[m.id] !== undefined && (
                    <div className="mt-3 p-2 rounded-md bg-[var(--color-surface-2)]">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-1">
                        AI suggested reply (you can edit)
                      </div>
                      <textarea
                        value={drafts[m.id]}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [m.id]: e.target.value }))
                        }
                        rows={3}
                        className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1.5 text-sm"
                      />
                      <div className="mt-2 flex gap-2 flex-wrap">
                        <button
                          onClick={() => sendReply(m.id)}
                          disabled={sending.has(m.id) || !drafts[m.id]?.trim()}
                          className="text-xs px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
                        >
                          {sending.has(m.id) ? "Sending…" : "✅ Send as me"}
                        </button>
                        <button
                          onClick={() => suggest(m.id)}
                          disabled={suggesting.has(m.id)}
                          className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                        >
                          {suggesting.has(m.id) ? "…" : "🔁 Regenerate"}
                        </button>
                        <button
                          onClick={() =>
                            setDrafts((d) => {
                              const n = { ...d };
                              delete n[m.id];
                              return n;
                            })
                          }
                          className="text-xs px-3 py-1.5 rounded-md text-[var(--color-text-dim)]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="shrink-0 self-end sm:self-auto flex flex-col gap-1.5 items-stretch">
                  {!m.handledAt && drafts[m.id] === undefined && (
                    <button
                      onClick={() => suggest(m.id)}
                      disabled={suggesting.has(m.id)}
                      className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {suggesting.has(m.id) ? "Suggesting…" : "🤖 AI suggest"}
                    </button>
                  )}
                  {!m.handledAt && secretaries.length > 0 && (
                    <select
                      defaultValue=""
                      disabled={forwarding.has(m.id)}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        e.target.value = "";
                        if (Number.isFinite(v) && v > 0) forwardTo(m.id, v);
                      }}
                      className="text-xs px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
                    >
                      <option value="" disabled>
                        {forwarding.has(m.id) ? "Forwarding…" : "↗ Forward to…"}
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
                      onClick={() => setHandled(m.id, false)}
                      className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                    >
                      Unhandle
                    </button>
                  ) : (
                    <button
                      onClick={() => setHandled(m.id, true)}
                      className="text-xs px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white"
                    >
                      Mark handled
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </Shell>
  );
}
