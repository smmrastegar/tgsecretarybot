import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  addChatNote,
  chatNoteExists,
  deleteGroupAnalytics,
  getCachedGroupAnalytics,
  getChatRule,
  getGroupAnalyticsShareToken,
  listChatMessagesForAnalysis,
  listForumTopics,
  upsertGroupAnalytics,
} from "@/lib/db";import { getSettings } from "@/lib/settings";
import {
  analyzeGroupTasksV2,
  type GroupCriticalItem,
} from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST recomputes (manual refresh button); GET returns cache and only
// computes when there's nothing cached yet.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handle(request, ctx, { allowCompute: true, preferCache: false });
}
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handle(request, ctx, { allowCompute: true, preferCache: true });
}

// Operator-triggered cleanup: drop every cached window for this chat
// so the next compute starts fresh (no stale "from beginning" mixed
// with newer bounded windows showing conflicting task states).
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid chat id" }, { status: 400 });
  }
  const deleted = await deleteGroupAnalytics(chatId);
  return NextResponse.json({ ok: true, deleted });
}

async function handle(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
  opts: { allowCompute: boolean; preferCache: boolean },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid chat id" }, { status: 400 });
  }
  const url = new URL(request.url);
  // days=0 means "all-time": no time floor on the message scan, cached
  // separately under window_days=0 so it doesn't overwrite the bounded
  // windows. The operator hits "از ابتدا" to opt into it.
  const daysRaw = url.searchParams.get("days") ?? "7";
  const allTime = daysRaw === "0" || daysRaw === "all";
  const days = allTime
    ? 0
    : Math.min(Math.max(Number(daysRaw), 1), 90);
  const force = url.searchParams.get("force") === "1";

  // Cache hit: serve unless ?force=1 OR the cached row has zero
  // messages (poisoned by an earlier failed compute / empty chat) OR
  // the cached analysis came back with zero tasks despite there being
  // a meaningful number of messages — that's almost always an LLM hiccup
  // and re-running gives the operator a chance to recover without
  // needing to hit "↻ پردازش مجدد" manually.
  if (opts.preferCache && !force) {
    const cached = await getCachedGroupAnalytics(chatId, days).catch(
      () => null,
    );
    const cachedTasks =
      cached && typeof cached.analysis === "object" && cached.analysis !== null
        ? ((cached.analysis as { tasks?: unknown[] }).tasks ?? [])
        : [];
    const looksStale =
      cached != null && cached.messageCount >= 30 && cachedTasks.length === 0;
    if (cached && cached.messageCount > 0 && !looksStale) {
      const [token, currentTopicsList] = await Promise.all([
        getGroupAnalyticsShareToken(chatId).catch(() => null),
        listForumTopics(chatId, { includeArchived: true }).catch(() => []),
      ]);
      return NextResponse.json({
        ok: true,
        cached: true,
        chatTitle: cached.chatTitle,
        sinceIso: cached.sinceIso,
        messageCount: cached.messageCount,
        analysis: cached.analysis,
        cachedAt: cached.createdAt,
        shareToken: token,
        currentTopics: currentTopicsList.map((t) => ({
          name:
            t.name && t.name.trim() ? t.name : `Topic #${t.messageThreadId}`,
          messageThreadId: t.messageThreadId,
          archived: t.archivedAt != null,
        })),
      });
    }
    if (!opts.allowCompute) {
      return NextResponse.json({
        ok: true,
        empty: true,
        chatTitle: null,
        sinceIso: null,
        messageCount: 0,
        analysis: null,
      });
    }
  }

  // All-time = epoch start + bump the message cap. Bounded windows
  // keep the existing 1500-message cap which is fine for ≤30 days.
  const since = allTime
    ? new Date(0)
    : new Date(Date.now() - days * 86400_000);
  const { chatTitle, messages } = await listChatMessagesForAnalysis({
    chatId,
    since,
    limit: allTime ? 5000 : 1500,
  });
  const token = await getGroupAnalyticsShareToken(chatId).catch(() => null);
  if (messages.length === 0) {
    return NextResponse.json({
      ok: true,
      empty: true,
      chatTitle,
      sinceIso: since.toISOString(),
      messageCount: 0,
      analysis: null,
      shareToken: token,
    });
  }
  const settings = await getSettings();
  const rule = await getChatRule(chatId).catch(() => null);
  // Resolve topic_name for every message via the forum_topics table.
  // Falls back to "Topic #<id>" if the bot saw a message in a topic
  // before it saw the forum_topic_created event.
  const topics = await listForumTopics(chatId).catch(() => []);
  const topicNameByThread = new Map<number, string>();
  for (const t of topics) {
    topicNameByThread.set(
      t.messageThreadId,
      t.name && t.name.trim() ? t.name : `Topic #${t.messageThreadId}`,
    );
  }
  const messagesWithTopics = messages.map((m) => ({
    sender: m.fromOwner
      ? settings.ownerDisplayName || settings.ownerName || "owner"
      : m.sender,
    text: m.text,
    at: m.at,
    topicName:
      m.messageThreadId == null
        ? null
        : (topicNameByThread.get(m.messageThreadId) ??
          `Topic #${m.messageThreadId}`),
  }));

  const analysis = await analyzeGroupTasksV2({
    chatId,
    chatTitle,
    ownerName: settings.ownerName,
    ownerContext: settings.ownerContext,
    chatNotes: rule?.notes ?? null,
    topics:
      topics.length > 0
        ? topics.map((t) => ({
            name:
              t.name && t.name.trim()
                ? t.name
                : `Topic #${t.messageThreadId}`,
            messageThreadId: t.messageThreadId,
            notes: t.notes,
          }))
        : undefined,
    messages: messagesWithTopics,
  });
  await upsertGroupAnalytics({
    chatId,
    chatTitle,
    windowDays: days,
    sinceIso: since.toISOString(),
    messageCount: messages.length,
    analysis,
  }).catch((err) => console.warn("[groups] cache write failed:", err));

  // Record critical items so the dashboard /notes viewer shows them.
  // Deliberately no Telegram push — see recordCriticalItems.
  if (analysis.criticalForInbox.length > 0) {
    await recordCriticalItems({
      chatId,
      chatTitle,
      items: analysis.criticalForInbox,
    }).catch((err) => console.warn("[groups] critical record failed:", err));
  }
  // Send the full topic list (including archived) so the frontend
  // can render correctly without an extra round-trip — archived
  // entries become struck-through in the UI rather than just hidden.
  const allTopicsForFrontend = await listForumTopics(chatId, {
    includeArchived: true,
  }).catch(() => topics);
  return NextResponse.json({
    ok: true,
    cached: false,
    chatTitle,
    sinceIso: since.toISOString(),
    messageCount: messages.length,
    analysis,
    shareToken: token,
    currentTopics: allTopicsForFrontend.map((t) => ({
      name:
        t.name && t.name.trim() ? t.name : `Topic #${t.messageThreadId}`,
      messageThreadId: t.messageThreadId,
      archived: t.archivedAt != null,
    })),
  });
}

const KIND_BADGE: Record<GroupCriticalItem["kind"], string> = {
  overdue: "⏰ معوق",
  conflict: "⚔️ بحث/دعوا",
  stuck: "🛑 گیر کرده",
  escalation: "📣 درخواست رسیدگی",
};

function escHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
  );
}

// Records critical items from an analysis.
//
// This used to also push every item into the notes_inbox channel on
// EVERY run. Re-analysing a group is a normal thing to do — the
// dashboard button, the MCP tool — and each run re-sent the same cards,
// so the channel filled up with repeats of items the operator had
// already read. Nothing is pushed to Telegram from here now; the items
// still land in chat_notes, which is what /notes renders.
async function recordCriticalItems(args: {
  chatId: number;
  chatTitle: string | null;
  items: GroupCriticalItem[];
}): Promise<void> {
  for (const it of args.items) {
    const title = `${KIND_BADGE[it.kind]} — ${it.title}`;
    // Same reason: a re-run must not append a second copy.
    if (await chatNoteExists({ chatId: args.chatId, kind: "group_critical", title }).catch(() => false)) {
      continue;
    }
    await addChatNote({
      chatId: args.chatId,
      kind: "group_critical",
      title,
      content: it.details,
      metadata: {
        kind: it.kind,
        topic_name: it.topicName,
        people: it.people,
        evidence: it.evidence,
        chat_title: args.chatTitle,
      },
    }).catch((err) =>
      console.warn(`[groups] chat_notes write failed (${it.kind}):`, err),
    );
  }
}
