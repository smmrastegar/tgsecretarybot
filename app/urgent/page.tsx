"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import MediaView from "@/components/MediaView";
import { chatTypeLabel, relTime } from "@/lib/format";

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
  chatMode: ChatMode;
};

export default function UrgentPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHandled, setShowHandled] = useState(false);
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState<"all" | ChatMode>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulking, setBulking] = useState(false);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filtered = (() => {
    const q = search.trim().toLowerCase();
    return messages.filter((m) => {
      if (modeFilter !== "all" && m.chatMode !== modeFilter) return false;
      if (!q) return true;
      const hay = [
        m.messageText,
        m.transcript,
        m.senderName,
        m.chatTitle,
        m.reason,
      ];
      return hay.some((f) => f && f.toLowerCase().includes(q));
    });
  })();

  function selectAllFiltered() {
    setSelected(new Set(filtered.map((m) => m.id)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  async function runBulk(op: "handle" | "unhandle") {
    if (selected.size === 0) return;
    setBulking(true);
    try {
      const r = await fetch("/api/messages/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, ids: [...selected] }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        alert(`عملیات شکست خورد: ${j.error ?? r.status}`);
      } else {
        setSelected(new Set());
        await load();
      }
    } finally {
      setBulking(false);
    }
  }

  const firstLoadRef = useRef(true);
  const load = useCallback(async () => {
    if (firstLoadRef.current) setLoading(true);
    try {
      const url = `/api/messages?urgent=1${showHandled ? "" : "&unhandled=1"}`;
      const r = await fetch(url);
      if (!r.ok) return;
      const j = (await r.json()) as { messages: Message[] };
      // Merge new items into existing list, preserving any rows still present
      // so React keeps per-card state (drafts, etc.) and the page doesn't blink.
      setMessages((prev) => {
        const incoming = new Map(j.messages.map((m) => [m.id, m]));
        const kept = prev.filter((m) => incoming.has(m.id)).map((m) => incoming.get(m.id)!);
        const keptIds = new Set(kept.map((m) => m.id));
        const added = j.messages.filter((m) => !keptIds.has(m.id));
        return [...added, ...kept];
      });
    } finally {
      setLoading(false);
      firstLoadRef.current = false;
    }
  }, [showHandled]);

  useEffect(() => {
    firstLoadRef.current = true;
    setMessages([]);
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
  const [handingOver, setHandingOver] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<Record<number, string>>({});
  const [secretaries, setSecretaries] = useState<
    { userId: number; name: string }[]
  >([]);

  function showToast(id: number, text: string) {
    setToast((t) => ({ ...t, [id]: text }));
    setTimeout(() => {
      setToast((t) => {
        const n = { ...t };
        delete n[id];
        return n;
      });
    }, 3000);
  }

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
        body: JSON.stringify({ text, markHandled: true, setMode: "ai_chat" }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setDrafts((d) => {
        const n = { ...d };
        delete n[id];
        return n;
      });
      showToast(id, "✅ Sent — AI will handle this chat from now on");
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
      const j = (await r.json()) as {
        error?: string;
        secretary?: { name: string };
      };
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      showToast(id, `↗ Forwarded to ${j.secretary?.name ?? "secretary"}`);
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

  async function handOverToAi(id: number) {
    setHandingOver((s) => new Set(s).add(id));
    try {
      const r = await fetch(`/api/messages/${id}/ai-handle`, {
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
        id,
        preview
          ? `🤖 AI replied: ${preview}${(j.reply ?? "").length > 140 ? "…" : ""}`
          : "🤖 AI handled this chat. Future messages will get AI replies too.",
      );
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setHandingOver((s) => {
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
        <>
        <Card className="mb-3 !p-3">
          <div className="flex flex-col gap-2">
            <input
              dir="auto"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جستجو در متن / sender / chat / دلیل…"
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="text-[var(--color-text-dim)]">Mode:</span>
              <select
                value={modeFilter}
                onChange={(e) =>
                  setModeFilter(e.target.value as "all" | ChatMode)
                }
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
              >
                <option value="all">همه ({messages.length})</option>
                {(Object.keys(MODE_LABEL) as ChatMode[]).map((m) => {
                  const n = messages.filter((msg) => msg.chatMode === m)
                    .length;
                  return (
                    <option key={m} value={m}>
                      {MODE_LABEL[m].label} ({n})
                    </option>
                  );
                })}
              </select>
              <span className="text-[var(--color-text-dim)] ml-auto">
                {filtered.length} نمایش / {selected.size} انتخاب
              </span>
            </div>
            {selected.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap text-xs pt-2 border-t border-[var(--color-border)]">
                <button
                  onClick={selectNone}
                  disabled={bulking}
                  className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                >
                  Clear
                </button>
                <button
                  onClick={() => runBulk("handle")}
                  disabled={bulking}
                  className="px-2 py-1 rounded-md border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-50"
                >
                  ✓ Mark handled
                </button>
                <button
                  onClick={() => runBulk("unhandle")}
                  disabled={bulking}
                  className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                >
                  Un-handle
                </button>
              </div>
            )}
            {filtered.length > 0 && (
              <button
                onClick={selectAllFiltered}
                className="self-start text-[10px] text-[var(--color-text-dim)] hover:text-white underline-offset-2 hover:underline"
              >
                انتخاب همه‌ی {filtered.length} مورد فیلترشده
              </button>
            )}
          </div>
        </Card>
        {filtered.length === 0 && (
          <Card>
            <p className="text-sm text-[var(--color-text-dim)]">
              هیچ پیامی با این فیلتر مطابقت نداره.
            </p>
          </Card>
        )}
        <ul className="flex flex-col gap-3">
          {filtered.map((m) => (
            <Card
              key={m.id}
              className={
                selected.has(m.id)
                  ? "ring-1 ring-[var(--color-accent)]"
                  : ""
              }
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(m.id)}
                  onChange={() => toggleSelect(m.id)}
                  className="mt-1 shrink-0"
                />
              <div className="flex-1 min-w-0 flex flex-col sm:flex-row items-stretch sm:items-start sm:justify-between gap-3 sm:gap-4">
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
                  <div
                    dir="auto"
                    className="text-sm leading-relaxed whitespace-pre-wrap break-words"
                  >
                    {m.messageText}
                  </div>
                  {m.transcript && (
                    <div className="mt-2 p-2 rounded-md bg-[var(--color-surface-2)] text-sm">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-1">
                        transcript
                      </div>
                      <div
                        dir="auto"
                        className="whitespace-pre-wrap break-words"
                      >
                        {m.transcript}
                      </div>
                    </div>
                  )}
                  {m.mediaKind && (
                    <div className="mt-2">
                      <MediaView messageId={m.id} kind={m.mediaKind} />
                    </div>
                  )}
                  <div className="text-xs text-[var(--color-text-dim)] mt-2 italic">
                    {m.reason}
                  </div>
                  <div className="mt-3 flex gap-2 flex-wrap items-center">
                    <Badge tone="danger">imp {m.importance}/10</Badge>
                    <Badge tone={MODE_LABEL[m.chatMode].tone}>
                      {MODE_LABEL[m.chatMode].label}
                    </Badge>
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

                  {toast[m.id] && (
                    <div className="mt-2 p-2 rounded-md bg-emerald-900/40 border border-emerald-800 text-emerald-200 text-xs">
                      {toast[m.id]}
                    </div>
                  )}
                  {drafts[m.id] !== undefined && (
                    <div className="mt-3 p-2 rounded-md bg-[var(--color-surface-2)]">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-1">
                        AI suggested reply (you can edit)
                      </div>
                      <textarea
                        dir="auto"
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
                  {!m.handledAt &&
                    (m.chatMode === "ai_chat" ? (
                      <span className="text-xs px-3 py-1.5 rounded-md border border-emerald-700 bg-emerald-900/30 text-emerald-300">
                        ✓ AI handling
                      </span>
                    ) : (
                      <button
                        onClick={() => handOverToAi(m.id)}
                        disabled={handingOver.has(m.id)}
                        className="text-xs px-3 py-1.5 rounded-md border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-50"
                      >
                        {handingOver.has(m.id) ? "Switching…" : "🤖 Full AI"}
                      </button>
                    ))}
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
              </div>
            </Card>
          ))}
        </ul>
        </>
      )}
    </Shell>
  );
}
