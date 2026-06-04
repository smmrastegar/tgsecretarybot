"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime } from "@/lib/format";

type SummaryRow = {
  chatId: number;
  total: number;
  byKind: Record<string, number>;
  lastNoteAt: string;
};

type Note = {
  id: number;
  chatId: number;
  sourceMessageId: number | null;
  kind: string;
  title: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
  senderName: string | null;
  archivedAt: string | null;
  createdAt: string;
};

const KIND_EMOJI: Record<string, string> = {
  address: "🏠",
  location: "📍",
  contact: "👤",
  phone: "📞",
  url: "🔗",
  note: "📝",
  date: "📅",
};

export default function NotesPage() {
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [openChat, setOpenChat] = useState<number | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [kindFilter, setKindFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [notesLoading, setNotesLoading] = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/notes");
      if (r.ok) {
        const j = (await r.json()) as { summary: SummaryRow[] };
        setSummary(j.summary);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadNotes = useCallback(async () => {
    if (openChat == null) return;
    setNotesLoading(true);
    try {
      const params = new URLSearchParams({ chatId: String(openChat) });
      if (kindFilter) params.set("kind", kindFilter);
      const r = await fetch(`/api/notes?${params.toString()}`);
      if (r.ok) {
        const j = (await r.json()) as { notes: Note[] };
        setNotes(j.notes);
      }
    } finally {
      setNotesLoading(false);
    }
  }, [openChat, kindFilter]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  async function deleteNote(id: number) {
    if (!confirm("این note حذف بشه؟")) return;
    const r = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (r.ok) {
      await loadNotes();
      await loadSummary();
    }
  }

  const kinds = useMemo(() => {
    const out = new Set<string>();
    for (const row of summary) for (const k of Object.keys(row.byKind)) out.add(k);
    return Array.from(out).sort();
  }, [summary]);

  return (
    <Shell>
      <PageTitle
        title="📒 Notes"
        subtitle="نکات مهم استخراج‌شده از هر چت — آدرس، لوکیشن، شماره، تماس، نکات."
      />

      {loading ? (
        <Card>Loading…</Card>
      ) : summary.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            هنوز note ای ثبت نشده. روی صفحه‌ی هر چت گزینه‌ی
            «📒 auto-extract notes» رو فعال کن تا برای آدرس / لوکیشن / تماس‌ها
            خودکار note بسازه. می‌تونی دستی هم از صفحه‌ی چت note اضافه کنی.
          </p>
        </Card>
      ) : (
        <Card className="mb-3">
          <div className="text-xs text-[var(--color-text-dim)] mb-2">
            {summary.length} چت ·{" "}
            {summary.reduce((a, s) => a + s.total, 0)} note مجموعاً
          </div>
          <div className="flex flex-col gap-1.5">
            {summary.map((row) => (
              <button
                key={row.chatId}
                onClick={() =>
                  setOpenChat(openChat === row.chatId ? null : row.chatId)
                }
                className={`text-right p-2 rounded-md border transition-colors ${
                  openChat === row.chatId
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                    : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                  <Link
                    href={`/chats/${row.chatId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium hover:underline"
                  >
                    chat {row.chatId}
                  </Link>
                  <div className="flex items-center gap-1 flex-wrap">
                    {Object.entries(row.byKind).map(([k, n]) => (
                      <Badge key={k} tone="info">
                        {KIND_EMOJI[k] ?? "📝"} {k} · {n}
                      </Badge>
                    ))}
                    <span className="text-[10px] text-[var(--color-text-dim)]">
                      {relTime(row.lastNoteAt)}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {openChat != null && (
        <Card>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div className="text-sm font-medium">
              📒 Notes · chat {openChat}
            </div>
            <div className="flex items-center gap-2">
              <select
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value)}
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs"
              >
                <option value="">همه</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {KIND_EMOJI[k] ?? "📝"} {k}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setOpenChat(null)}
                className="text-xs px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              >
                ✕
              </button>
            </div>
          </div>
          {notesLoading ? (
            <div className="text-[11px] text-[var(--color-text-dim)]">…</div>
          ) : notes.length === 0 ? (
            <div className="text-[11px] text-[var(--color-text-dim)]">
              note ای نیست
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {notes.map((n) => {
                const gmaps =
                  (n.metadata?.gmaps as string | undefined) ?? null;
                const url = (n.metadata?.url as string | undefined) ?? null;
                return (
                  <div
                    key={n.id}
                    className="text-xs p-2 rounded-md border border-[var(--color-border)]"
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge tone="info">
                        {KIND_EMOJI[n.kind] ?? "📝"} {n.kind}
                      </Badge>
                      {n.title && (
                        <span className="font-medium">{n.title}</span>
                      )}
                      <span className="text-[10px] text-[var(--color-text-dim)] mr-auto">
                        {relTime(n.createdAt)}
                        {n.senderName ? ` · ${n.senderName}` : ""}
                      </span>
                      <button
                        onClick={() => deleteNote(n.id)}
                        className="text-[10px] px-1.5 py-0.5 rounded-md border border-red-700 text-red-300 hover:bg-red-900/30"
                      >
                        🗑
                      </button>
                    </div>
                    <div dir="auto" className="whitespace-pre-wrap break-words">
                      {n.content}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap text-[10px]">
                      {gmaps && (
                        <a
                          href={gmaps}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 underline"
                        >
                          🗺 Google Maps
                        </a>
                      )}
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 underline break-all"
                        >
                          {url}
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </Shell>
  );
}
