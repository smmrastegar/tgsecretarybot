"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import Chip, { type ChipTone } from "@/components/dash/Chip";
import MediaView from "@/components/MediaView";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/Dialogs";
import { chatTypeLabel, relTime } from "@/lib/format";

const fa = (v: number | string) =>
  String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

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
  friendly_reply: { label: "AI صمیمی", tone: "info" },
  ai_chat: { label: "چت AI", tone: "ok" },
  ai_listen: { label: "شنود AI", tone: "info" },
};

// Secondary button: 44px, outlined.
const BTN =
  "min-h-11 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] disabled:opacity-50";

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
  const [bulkErr, setBulkErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

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
    setBulkErr(null);
    try {
      const r = await fetch("/api/messages/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, ids: [...selected] }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setBulkErr(`عملیات شکست خورد: ${j.error ?? r.status}`);
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
      if (!r.ok) {
        setLoadErr(`بارگذاری انجام نشد (${fa(r.status)})`);
        return;
      }
      const j = (await r.json()) as { messages: Message[] };
      setLoadErr(null);
      // Merge new items into existing list, preserving any rows still present
      // so React keeps per-card state (drafts, etc.) and the page doesn't blink.
      setMessages((prev) => {
        const incoming = new Map(j.messages.map((m) => [m.id, m]));
        const kept = prev.filter((m) => incoming.has(m.id)).map((m) => incoming.get(m.id)!);
        const keptIds = new Set(kept.map((m) => m.id));
        const added = j.messages.filter((m) => !keptIds.has(m.id));
        return [...added, ...kept];
      });
    } catch {
      setLoadErr("ارتباط با سرور برقرار نشد");
    } finally {
      setLoading(false);
      firstLoadRef.current = false;
    }
  }, [showHandled]);

  function retryLoad() {
    firstLoadRef.current = true;
    void load();
  }

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
  const [toast, setToast] = useState<Record<number, { text: string; err: boolean }>>({});
  const [secretaries, setSecretaries] = useState<
    { userId: number; name: string }[]
  >([]);

  // Per-card status line (green = done, red = failed; errors stay a little longer).
  function showToast(id: number, text: string, err = false) {
    setToast((t) => ({ ...t, [id]: { text, err } }));
    setTimeout(() => {
      setToast((t) => {
        const n = { ...t };
        delete n[id];
        return n;
      });
    }, err ? 6000 : 3000);
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
      showToast(id, err instanceof Error ? err.message : String(err), true);
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
      // Sending ONE reply must not hand the chat to the AI. Flipping a
      // chat into ai_chat mode is a separate, explicit decision made with
      // the «🤖 کامل AI» button — never a side effect of pressing send.
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
      showToast(id, "✅ ارسال شد");
      load();
    } catch (err) {
      showToast(id, err instanceof Error ? err.message : String(err), true);
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
      showToast(id, `↗ فوروارد شد به ${j.secretary?.name ?? "منشی"}`);
    } catch (err) {
      showToast(id, err instanceof Error ? err.message : String(err), true);
    } finally {
      setForwarding((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function handOverToAi(id: number) {
    // Persistent + outward-facing: from now on the AI answers this person
    // as the owner, unprompted. Never do that on a stray click.
    const who = messages.find((x) => x.id === id);
    const label = who?.chatTitle || who?.senderName || "این چت";
    const ok = await confirmDialog(
      `«${label}» به AI سپرده شود؟\n\n` +
        "AI همین حالا جواب می‌دهد و از این پس پیام‌های بعدی این چت را هم " +
        "خودش به‌جای تو پاسخ می‌دهد.\n\n" +
        "برای پاسخ یک‌باره، به‌جای این از «🤖 پیشنهاد AI» استفاده کن.",
      { title: "سپردن چت به AI", confirmLabel: "بسپار به AI" },
    );
    if (!ok) return;
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
          ? `🤖 AI جواب داد: ${preview}${(j.reply ?? "").length > 140 ? "…" : ""}`
          : "🤖 AI به این چت رسیدگی کرد. پیام‌های بعدی هم پاسخ AI می‌گیرن.",
      );
      load();
    } catch (err) {
      showToast(id, err instanceof Error ? err.message : String(err), true);
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
      showToast(id, err instanceof Error ? err.message : String(err), true);
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
        title="صندوق فوری"
        subtitle="پیام‌هایی که AI به‌عنوان فوری و مربوط به تو علامت زده."
      />

      {loading ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</p>
        </Card>
      ) : loadErr && messages.length === 0 ? (
        <Card>
          <p role="alert" className="text-sm text-rose-300">{loadErr}</p>
          <div className="mt-3 flex">
            <button onClick={retryLoad} className={BTN}>تلاش دوباره</button>
          </div>
        </Card>
      ) : (
        <>
          <Card className="mb-3 !p-3">
            <div className="flex flex-col gap-2.5">
              <input
                dir="auto"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="جستجو"
                placeholder="جستجو در متن / فرستنده / چت / دلیل…"
                className="w-full min-h-11 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 text-sm text-center"
              />
              <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">
                <select
                  value={modeFilter}
                  onChange={(e) =>
                    setModeFilter(e.target.value as "all" | ChatMode)
                  }
                  aria-label="فیلتر حالت چت"
                  className="min-h-11 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-2 text-sm"
                >
                  <option value="all">حالت: همه ({fa(messages.length)})</option>
                  {(Object.keys(MODE_LABEL) as ChatMode[]).map((m) => {
                    const n = messages.filter((msg) => msg.chatMode === m)
                      .length;
                    return (
                      <option key={m} value={m}>
                        {MODE_LABEL[m].label} ({fa(n)})
                      </option>
                    );
                  })}
                </select>
                <label className="min-h-11 flex items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showHandled}
                    onChange={(e) => setShowHandled(e.target.checked)}
                  />
                  رسیدگی‌شده‌ها
                </label>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-dim)]">
                <span className="tabular-nums">
                  {fa(filtered.length)} نمایش / {fa(selected.size)} انتخاب
                </span>
                {filtered.length > 0 && (
                  <button onClick={selectAllFiltered} className="min-h-10 px-2 rounded-lg text-xs underline underline-offset-2 active:bg-[var(--color-surface-2)]">
                    انتخاب همه
                  </button>
                )}
              </div>
              {loadErr && (
                <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {loadErr}
                  <button onClick={retryLoad} className="ms-2 min-h-10 px-3 rounded-lg border border-rose-500/40">تلاش دوباره</button>
                </div>
              )}
            </div>
          </Card>

          {messages.length === 0 ? (
            <EmptyState
              icon="✅"
              title="صندوق خالیه"
              hint="هیچ پیام فوری‌ای در انتظار نیست."
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="🔍"
              title="هیچ پیامی با این فیلتر مطابقت نداره."
              action={
                <button onClick={() => { setSearch(""); setModeFilter("all"); }} className={BTN}>پاک کردن فیلتر</button>
              }
            />
          ) : (
            <ul className={`grid grid-cols-1 lg:grid-cols-2 gap-3 items-start ${selected.size > 0 ? "pb-32" : ""}`}>
              {filtered.map((m) => (
                <li key={m.id} className="min-w-0">
                  <Card
                    className={`!p-3 md:!p-4 ${
                      selected.has(m.id) ? "ring-1 ring-[var(--color-accent)]" : ""
                    }`}
                  >
                    {/* header: select box · who/where/when · (spacer keeps the text centred) */}
                    <div className="flex items-center gap-2">
                      <label className="shrink-0 grid place-items-center w-11 h-11 -m-1 cursor-pointer" aria-label="انتخاب پیام">
                        <input
                          type="checkbox"
                          checked={selected.has(m.id)}
                          onChange={() => toggleSelect(m.id)}
                        />
                      </label>
                      <div className="min-w-0 flex-1">
                        <div dir="auto" className="text-sm font-medium truncate">{m.senderName}</div>
                        <div className="text-xs text-[var(--color-text-dim)] truncate">
                          {relTime(m.createdAt)} · {chatTypeLabel(m.chatType)}
                          {m.chatTitle ? ` · ${m.chatTitle}` : ""}
                        </div>
                      </div>
                      <span aria-hidden className="shrink-0 w-9" />
                    </div>

                    <div
                      dir="auto"
                      className="mt-3 text-sm leading-7 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                    >
                      {m.messageText}
                    </div>
                    {m.transcript && (
                      <div className="mt-2 p-2.5 rounded-xl bg-[var(--color-surface-2)] text-sm">
                        <div className="text-xs text-[var(--color-text-dim)] mb-1">
                          رونویسی
                        </div>
                        <div dir="auto" className="whitespace-pre-wrap break-words leading-7">
                          {m.transcript}
                        </div>
                      </div>
                    )}
                    {m.mediaKind && (
                      <div className="mt-2 flex justify-center">
                        <MediaView messageId={m.id} kind={m.mediaKind} />
                      </div>
                    )}
                    <div className="mt-2 text-xs leading-6 text-[var(--color-text-dim)] italic">
                      {m.reason}
                    </div>
                    <div className="mt-2 flex gap-1.5 flex-wrap items-center justify-center">
                      <Chip tone="danger">اهمیت {fa(m.importance)}/{fa(10)}</Chip>
                      <Chip tone={MODE_LABEL[m.chatMode].tone}>
                        {MODE_LABEL[m.chatMode].label}
                      </Chip>
                      {m.alerted && <Chip tone="warn">هشدار داده شد</Chip>}
                      {m.autoReplied && <Chip tone="info">پاسخ خودکار</Chip>}
                      {m.mediaKind && <Chip>{m.mediaKind}</Chip>}
                      {m.handledAt && <Chip tone="ok">رسیدگی شد</Chip>}
                    </div>

                    {toast[m.id] && (
                      <div
                        role="status"
                        className={`mt-3 rounded-xl border px-3 py-2.5 text-xs leading-6 ${
                          toast[m.id]!.err
                            ? "bg-rose-900/30 border-rose-800 text-rose-200"
                            : "bg-emerald-900/40 border-emerald-800 text-emerald-200"
                        }`}
                      >
                        {toast[m.id]!.text}
                      </div>
                    )}

                    {drafts[m.id] !== undefined && (
                      <div className="mt-3 p-2.5 rounded-xl bg-[var(--color-surface-2)]">
                        <div className="text-xs text-[var(--color-text-dim)] mb-1.5">
                          پاسخ پیشنهادی AI (قابل ویرایش)
                        </div>
                        <textarea
                          dir="auto"
                          value={drafts[m.id]}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [m.id]: e.target.value }))
                          }
                          rows={4}
                          aria-label="پاسخ پیشنهادی"
                          className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl px-3 py-2 text-sm leading-7"
                        />
                        <button
                          onClick={() => sendReply(m.id)}
                          disabled={sending.has(m.id) || !drafts[m.id]?.trim()}
                          className="mt-2 w-full min-h-11 rounded-xl bg-emerald-700 active:bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
                        >
                          {sending.has(m.id) ? "در حال ارسال…" : "✅ ارسال به‌جای من"}
                        </button>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button
                            onClick={() => suggest(m.id)}
                            disabled={suggesting.has(m.id)}
                            className={BTN}
                          >
                            {suggesting.has(m.id) ? "…" : "🔁 تولید دوباره"}
                          </button>
                          <button
                            onClick={() =>
                              setDrafts((d) => {
                                const n = { ...d };
                                delete n[m.id];
                                return n;
                              })
                            }
                            className={`${BTN} text-[var(--color-text-dim)]`}
                          >
                            لغو
                          </button>
                        </div>
                      </div>
                    )}

                    {/* actions: one primary per card; the rest in a 2-column grid */}
                    <div className="mt-3 flex flex-col gap-2">
                      {canTranscribe(m.mediaKind) && !m.transcript && (
                        <button
                          onClick={() => transcribe(m.id)}
                          disabled={transcribing.has(m.id)}
                          className={`${BTN} w-full`}
                        >
                          {transcribing.has(m.id) ? "در حال رونویسی…" : "🎙 رونویسی"}
                        </button>
                      )}
                      {!m.handledAt && drafts[m.id] === undefined && (
                        <button
                          onClick={() => suggest(m.id)}
                          disabled={suggesting.has(m.id)}
                          className="w-full min-h-11 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium active:opacity-80 disabled:opacity-50"
                        >
                          {suggesting.has(m.id) ? "در حال پیشنهاد…" : "🤖 پیشنهاد AI"}
                        </button>
                      )}
                      {!m.handledAt && (
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => setHandled(m.id, true)}
                            className="min-h-11 rounded-xl border border-emerald-700 text-emerald-300 text-sm active:bg-emerald-900/30"
                          >
                            ✓ رسیدگی شد
                          </button>
                          {m.chatMode === "ai_chat" ? (
                            <span className="min-h-11 grid place-items-center rounded-xl border border-emerald-700 bg-emerald-900/30 text-sm text-emerald-300">
                              ✓ در دست AI
                            </span>
                          ) : (
                            <button
                              onClick={() => handOverToAi(m.id)}
                              disabled={handingOver.has(m.id)}
                              className={BTN}
                            >
                              {handingOver.has(m.id) ? "در حال تغییر…" : "🤖 کامل AI"}
                            </button>
                          )}
                        </div>
                      )}
                      {!m.handledAt && secretaries.length > 0 && (
                        <select
                          defaultValue=""
                          disabled={forwarding.has(m.id)}
                          aria-label="فوروارد به منشی"
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            e.target.value = "";
                            if (Number.isFinite(v) && v > 0) forwardTo(m.id, v);
                          }}
                          className="w-full min-h-11 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                        >
                          <option value="" disabled>
                            {forwarding.has(m.id) ? "در حال فوروارد…" : "↗ فوروارد به…"}
                          </option>
                          {secretaries.map((s) => (
                            <option key={s.userId} value={s.userId}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {m.handledAt && (
                        <div className="flex">
                          <button onClick={() => setHandled(m.id, false)} className={BTN}>
                            لغو رسیدگی
                          </button>
                        </div>
                      )}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* bulk bar: floats above the phone's bottom nav while something is selected */}
      {selected.size > 0 && (
        <div className="fixed z-30 inset-x-3 bottom-[4.75rem] md:inset-x-auto md:bottom-6 md:left-8 md:w-[26rem] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-2xl">
          <div className="text-center text-xs text-[var(--color-text-dim)] mb-2">
            {fa(selected.size)} پیام انتخاب شده
          </div>
          {bulkErr && <div role="alert" className="mb-2 text-center text-xs text-rose-300">{bulkErr}</div>}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => runBulk("handle")}
              disabled={bulking}
              className="min-h-11 rounded-xl bg-emerald-700 text-white text-xs font-medium disabled:opacity-50"
            >
              ✓ رسیدگی شد
            </button>
            <button onClick={() => runBulk("unhandle")} disabled={bulking} className={`${BTN} !px-2 text-xs`}>
              لغو رسیدگی
            </button>
            <button onClick={selectNone} disabled={bulking} className={`${BTN} !px-2 text-xs`}>
              پاک کردن
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}
