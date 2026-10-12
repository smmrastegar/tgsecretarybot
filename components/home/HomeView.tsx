import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/Card";
import Chip from "@/components/dash/Chip";
import EmptyState from "@/components/ui/EmptyState";
import Section from "@/components/ui/Section";
import { chatTypeLabel, relTime, truncate } from "@/lib/format";
import type {
  BusinessConnectionRow,
  ExtractedItem,
  MessageRow,
  ChatMode,
} from "@/lib/db";

// Presentation of the overview page (the data is fetched in app/page.tsx). Mobile-first: one tappable
// "needs attention" hero, a few stat tiles, rows of >= 56px for the lists, and the rarely needed
// connections list folded away. Card content is centred.

export type OverviewStats = {
  urgentTotal: number;
  urgentUnhandled: number;
  alertsLast24h: number;
  autoRepliesLast24h: number;
  connections: number;
};
export type AiUsage = {
  totalCostUsd: number;
  totalTokens: number;
  totalCalls: number;
  last24hCostUsd: number;
};

const fa = (v: number | string) =>
  String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

// Small centred heading of a card.
function CardHead({ title, count }: { title: string; count?: number }) {
  return (
    <div className="mb-3 flex items-center justify-center gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {count != null && <Chip>{fa(count)}</Chip>}
    </div>
  );
}

// "See all" shortcut at the bottom of a list card: a full-width 44px target.
function SeeAll({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="mt-3 flex min-h-11 items-center justify-center rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-dim)] active:bg-[var(--color-surface-2)] hover:text-white"
    >
      دیدن همه ‹
    </Link>
  );
}

function Tile({ href, label, value, hint, tone, className = "" }: { className?: string; href?: string; label: string; value: ReactNode; hint?: string; tone?: "warn" | "danger" }) {
  const cls = `flex flex-col items-center justify-center rounded-2xl border px-3 py-4 min-h-24 text-center ${className} ${
    tone === "danger"
      ? "border-rose-500/40 bg-rose-500/10"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/10"
        : "border-[var(--color-border)] bg-[var(--color-surface)]"
  } ${href ? "active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]" : ""}`;
  const body = (
    <>
      <span className="text-xs text-[var(--color-text-dim)] leading-5">{label}</span>
      <span className="mt-1 text-2xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="mt-1 text-xs text-[var(--color-text-dim)] leading-5">{hint}</span>}
    </>
  );
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

const MODES: Array<{ key: ChatMode; label: string; tone: string }> = [
  { key: "secretary", label: "منشی", tone: "border-amber-700/70 text-amber-300" },
  { key: "ai_chat", label: "چت AI", tone: "border-emerald-700/70 text-emerald-300" },
  { key: "friendly_reply", label: "AI صمیمی", tone: "border-blue-700/70 text-blue-300" },
  { key: "auto_reply", label: "پاسخ خودکار", tone: "border-blue-700/70 text-blue-300" },
  { key: "off", label: "خاموش", tone: "border-[var(--color-border)] text-[var(--color-text-dim)]" },
];

export default function HomeView({ stats, latestUrgent, latest, ai, connections, modes, reminders, dueCount }: {
  stats: OverviewStats | null;
  latestUrgent: MessageRow[];
  latest: MessageRow[];
  ai: AiUsage | null;
  connections: BusinessConnectionRow[];
  modes: Record<ChatMode, number> | null;
  reminders: ExtractedItem[];
  dueCount: number;
}) {
  const connName = (c: BusinessConnectionRow) =>
    [c.firstName, c.lastName].filter(Boolean).join(" ") || c.username || `user ${c.userId}`;

  return (
    <>
      {!stats && (
        <div role="status" className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-4 text-center">
          <div aria-hidden className="text-2xl">⚠️</div>
          <p className="mt-1 text-sm leading-7 text-amber-200">
            دیتابیس پیکربندی نشده. برای فعال شدن ذخیره‌سازی و تحلیل‌ها، DATABASE_URL رو تنظیم کن.
          </p>
        </div>
      )}

      {stats && (
        <>
          {/* the one number that asks for action */}
          <Link
            href="/urgent"
            className={`mb-3 flex items-center gap-3 rounded-2xl border px-4 py-4 min-h-20 active:opacity-80 ${
              stats.urgentUnhandled > 0
                ? "border-rose-500/40 bg-rose-500/10"
                : "border-emerald-500/30 bg-emerald-500/10"
            }`}
          >
            <span aria-hidden className="grid place-items-center w-12 h-12 rounded-2xl bg-[var(--color-surface-2)] text-2xl shrink-0">
              {stats.urgentUnhandled > 0 ? "🚨" : "✅"}
            </span>
            <span className="min-w-0 flex-1 text-center">
              <span className="block text-xs text-[var(--color-text-dim)]">فوری رسیدگی‌نشده</span>
              <span className="block text-3xl font-semibold tabular-nums leading-tight">{fa(stats.urgentUnhandled)}</span>
              <span className="block text-xs text-[var(--color-text-dim)]">از {fa(stats.urgentTotal)} علامت‌خورده</span>
            </span>
            <span aria-hidden className="text-lg text-[var(--color-text-dim)]">‹</span>
          </Link>

          <div className="mb-3 grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Tile href="/messages" label="هشدارها (۲۴ ساعت)" value={fa(stats.alertsLast24h)} hint="به webhook فرستاده شد" />
            <Tile href="/messages" label="پاسخ‌های خودکار (۲۴ ساعت)" value={fa(stats.autoRepliesLast24h)} />
            <Tile className="max-lg:col-span-2" label="اتصال‌ها" value={fa(stats.connections)} hint="اکانت‌های business" />
          </div>
        </>
      )}

      {ai && (
        <div className="mb-3 grid grid-cols-2 gap-3">
          <Tile
            label="هزینه کل AI"
            value={<bdi dir="ltr">{`$${ai.totalCostUsd.toFixed(4)}`}</bdi>}
            hint={`${fa(ai.totalCalls)} فراخوانی`}
          />
          <Tile
            label="هزینه AI (۲۴ ساعت)"
            value={<bdi dir="ltr">{`$${ai.last24hCostUsd.toFixed(4)}`}</bdi>}
            hint={`${fa(Math.round(ai.totalTokens / 1000))} هزار توکن (کل)`}
          />
        </div>
      )}

      {reminders.length > 0 && (
        <Card className="mb-3 !p-3 md:!p-4">
          <CardHead title="یادآوری‌های پیش‌رو" count={dueCount} />
          <ul className="flex flex-col gap-2">
            {reminders.slice(0, 4).map((r) => (
              <li key={r.id}>
                <Link
                  href="/reminders"
                  className="flex flex-col justify-center min-h-14 rounded-xl bg-[var(--color-surface-2)] px-3 py-2 text-center active:opacity-80"
                >
                  <span dir="auto" className="text-sm font-medium line-clamp-2">{r.title}</span>
                  <span className="mt-0.5 text-xs text-[var(--color-text-dim)]">
                    {r.kind} ·{" "}
                    {r.dueAt
                      ? new Date(r.dueAt).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" })
                      : "بدون تاریخ"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <SeeAll href="/reminders" />
        </Card>
      )}

      {modes && (
        <Card className="mb-3 !p-3 md:!p-4">
          <CardHead title="چت‌ها بر اساس حالت" />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {MODES.map((m) => (
              <Link
                key={m.key}
                href="/chats"
                className={`flex flex-col items-center justify-center min-h-20 rounded-xl border px-2 py-3 max-md:last:col-span-2 active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)] ${m.tone}`}
              >
                <span className="text-xl font-semibold tabular-nums">{fa(modes[m.key])}</span>
                <span className="mt-1 text-xs">{m.label}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3 items-start">
        <Card className="!p-3 md:!p-4">
          <CardHead title="آخرین موارد فوری" />
          {latestUrgent.length === 0 ? (
            <EmptyState icon="✅" title="هنوز چیز فوری‌ای نیست." />
          ) : (
            <ul className="flex flex-col gap-2">
              {latestUrgent.map((m) => (
                <li key={m.id}>
                  <Link href="/urgent" className="block min-h-14 rounded-xl bg-[var(--color-surface-2)] px-3 py-2.5 text-center active:opacity-80">
                    <span dir="auto" className="block text-xs font-medium leading-5 truncate">{m.senderName}</span>
                    <span className="block text-xs text-[var(--color-text-dim)] leading-5 truncate">
                      {relTime(m.createdAt)} · {chatTypeLabel(m.chatType)}
                      {m.chatTitle ? ` · ${m.chatTitle}` : ""}
                    </span>
                    <span dir="auto" className="mt-1 block text-sm leading-6 line-clamp-3">{truncate(m.messageText, 200)}</span>
                    <span className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                      <Chip tone="danger">اهمیت {fa(m.importance)}</Chip>
                      {m.alerted && <Chip tone="warn">هشدار داده شد</Chip>}
                      {m.autoReplied && <Chip tone="info">پاسخ خودکار</Chip>}
                      {m.handledAt && <Chip tone="ok">رسیدگی شد</Chip>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {latestUrgent.length > 0 && <SeeAll href="/urgent" />}
        </Card>

        <Card className="!p-3 md:!p-4">
          <CardHead title="فعالیت اخیر" />
          {latest.length === 0 ? (
            <EmptyState icon="💬" title="هنوز پیامی نیست." />
          ) : (
            <ul className="flex flex-col gap-2">
              {latest.map((m) => (
                <li key={m.id}>
                  <Link href="/messages" className="block min-h-14 rounded-xl px-3 py-2 text-center border border-[var(--color-border)] active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]">
                    <span dir="auto" className="block text-xs font-medium leading-5 truncate">{m.senderName}</span>
                    <span className="block text-xs text-[var(--color-text-dim)] leading-5 truncate">
                      {chatTypeLabel(m.chatType)} · {relTime(m.createdAt)}
                    </span>
                    <span dir="auto" className="mt-0.5 block text-sm leading-6 line-clamp-2">{truncate(m.messageText, 110)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {latest.length > 0 && <SeeAll href="/messages" />}
        </Card>
      </div>

      {connections.length > 0 && (
        <Section
          icon="🔗"
          title="اکانت‌های تلگرام وصل‌شده"
          summary={connections.map(connName).join(" · ")}
          badge={<Chip>{fa(connections.length)}</Chip>}
        >
          <ul className="flex flex-col gap-2">
            {connections.map((c) => (
              <li key={c.id} className="rounded-xl border border-[var(--color-border)] px-3 py-2.5 min-h-14">
                <div dir="auto" className="text-sm font-medium truncate">{connName(c)}</div>
                <div dir="ltr" className="text-xs text-[var(--color-text-dim)] truncate">
                  {c.username ? `@${c.username} · ` : ""}id {c.userId}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                  {c.canReply ? <Chip tone="ok">امکان پاسخ ✓</Chip> : <Chip tone="warn">بدون حق پاسخ</Chip>}
                  {c.isEnabled ? <Chip tone="ok">فعال</Chip> : <Chip>غیرفعال</Chip>}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-6 text-[var(--color-text-dim)]">
            چند کاربر تلگرام می‌تونن از طریق Settings → Telegram Business → Chatbots این ربات رو وصل کنن. ربات برای هر
            اکانت یه session جدا نگه می‌داره.
          </p>
        </Section>
      )}
    </>
  );
}
