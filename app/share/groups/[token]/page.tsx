"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { normalizeEvidence } from "@/lib/evidence";
import type { Analysis, Task, TaskStatus } from "@/components/GroupAnalyticsView";
import Section, { Pill } from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
import { SHARE_CSS } from "./share.css";

type PublicResponse = {
  ok: boolean;
  empty?: boolean;
  chatTitle: string | null;
  sinceIso: string | null;
  messageCount: number;
  analysis: Analysis | null;
  cachedAt?: string;
  ageDays?: number | null;
  requestedDays?: number;
  servedDays?: number | null;
  fellBack?: boolean;
  availableWindows?: number[];
  error?: string;
};

const WINDOWS = [
  { label: "۳ روز", days: 3 },
  { label: "۷ روز", days: 7 },
  { label: "۱۴ روز", days: 14 },
  { label: "۳۰ روز", days: 30 },
  { label: "از ابتدا", days: 0 },
];

const STATUS = {
  done: { label: "انجام‌شده", cls: "done", pill: "ok" },
  in_progress: { label: "در حال انجام", cls: "prog", pill: "warn" },
  stalled: { label: "متوقف", cls: "stall", pill: "bad" },
  announced: { label: "اعلام‌شده", cls: "ann", pill: "info" },
} as const;

const KIND_LABEL: Record<string, string> = {
  overdue: "معوق", stalled: "متوقف", risk: "ریسک", win: "موفقیت",
  conflict: "تعارض", stuck: "گیرکرده", escalation: "تشدید",
};

const ROLE_LABEL: Record<string, string> = {
  executor: "مجری", reporter: "گزارش‌گر", supervisor: "ناظر", designer: "طراح",
  support: "پشتیبان", stakeholder: "ذی‌نفع", other: "سایر",
};

const fa = (n: number) => n.toLocaleString("fa-IR");
const ERR_NOT_FOUND = "این لینک گزارش معتبر نیست یا حذف شده است.";
const ERR_FAILED = "دریافت گزارش ناموفق بود. چند لحظه بعد دوباره تلاش کن.";
const ERR_NETWORK = "ارتباط با سرور برقرار نشد. اینترنت را بررسی کن و دوباره تلاش کن.";
const faDate = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime()) || d.getTime() < Date.UTC(2000, 0, 1)) return null;
  return d.toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
};
const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("") || "؟";

export default function SharedGroupReport({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { token } = use(params);
  const sp = use(searchParams);
  const [days, setDays] = useState(sp.days ? Number(sp.days) || 0 : 0);
  const [data, setData] = useState<PublicResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // task explorer state
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<TaskStatus | "all" | "overdue">("all");
  const [open, setOpen] = useState<number | null>(null);
  const [limit, setLimit] = useState(24);
  // Collapsible sections; everything opens while printing so the paper copy is complete.
  const [secOpen, setSecOpen] = useState({ crit: true, hl: true, tasks: false, topics: false, people: false });
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async (w: number) => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/public/groups/${token}?days=${w}`);
      const j = (await r.json().catch(() => null)) as PublicResponse | null;
      if (!r.ok || !j) {
        setErr(r.status === 404 ? ERR_NOT_FOUND : ERR_FAILED);
        return;
      }
      setData(j);
    } catch {
      setErr(ERR_NETWORK);
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(days); }, [days, load]);

  const a = data?.analysis ?? null;
  const s = a?.stats;
  const pct = s && s.totalTasks > 0 ? Math.round((s.done / s.totalTasks) * 100) : 0;

  // The analyser can emit the same issue twice with slightly different
  // wording; collapse those so the reader isn't shown duplicates.
  const critical = useMemo(() => {
    if (!a) return [];
    const seen = new Set<string>();
    return a.criticalForInbox.filter((c) => {
      const k = c.title.replace(/[\s‌«»"'`.,:؛()-]/g, "").toLowerCase();
      const dup = [...seen].some((p) => p.includes(k) || k.includes(p));
      if (dup) return false;
      seen.add(k);
      return true;
    });
  }, [a]);

  const tasks = useMemo(() => {
    if (!a) return [];
    const needle = q.trim().toLowerCase();
    return a.tasks.filter((t) => {
      if (filter === "overdue" && !(t.isOverdue || t.status === "stalled")) return false;
      if (filter !== "all" && filter !== "overdue" && t.status !== filter) return false;
      if (!needle) return true;
      return [t.title, t.owner, t.topicName, t.announcedBy]
        .filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [a, q, filter]);

  useEffect(() => { setLimit(24); }, [q, filter]);

  useEffect(() => {
    const on = () => setPrinting(true), off = () => setPrinting(false);
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    return () => { window.removeEventListener("beforeprint", on); window.removeEventListener("afterprint", off); };
  }, []);
  const sec = (k: keyof typeof secOpen) => ({
    open: printing || secOpen[k],
    onOpenChange: (o: boolean) => setSecOpen((v) => ({ ...v, [k]: o })),
  });

  const fresh = data?.ageDays;
  const freshTone = fresh == null ? "" : fresh <= 7 ? "ok" : fresh <= 30 ? "warn" : "old";
  const freshText = fresh == null ? "" : fresh === 0 ? "امروز" : fresh === 1 ? "دیروز" : `${fa(fresh)} روز پیش`;
  const availables = data?.availableWindows;
  const chips = availables?.length ? WINDOWS.filter((w) => availables.includes(w.days)) : WINDOWS;
  const active = data?.servedDays ?? days;

  const segs = s ? [
    { k: "done", v: s.done, label: "انجام‌شده" },
    { k: "prog", v: s.inProgress, label: "در حال انجام" },
    { k: "stall", v: s.stalled, label: "متوقف" },
    { k: "ann", v: s.announced, label: "اعلام‌شده" },
  ].filter((x) => x.v > 0) : [];
  const segTotal = segs.reduce((n, x) => n + x.v, 0) || 1;

  const lateCount = a ? a.tasks.filter((t) => t.isOverdue || t.status === "stalled").length : 0;
  const topicMsgs = a ? a.topicBreakdown.reduce((n, t) => n + t.messageCount, 0) : 0;
  const shown = printing ? tasks.length : limit;

  return (
    <div className="sg" dir="rtl">
      <style dangerouslySetInnerHTML={{ __html: SHARE_CSS }} />

      {/* ─── HERO ─────────────────────────────────────────── */}
      <header className="sg-hero">
        <div className="sg-hero-glow" aria-hidden />
        <div className="sg-wrap">
          <div className="sg-eyebrow">گزارش گروه · فقط‌خواندنی</div>
          <h1 className="sg-title" dir="auto">{data?.chatTitle ?? "گزارش گروه"}</h1>

          {a?.overview && <p className="sg-overview">{a.overview}</p>}

          <div className="sg-meta">
            {data && !data.empty && (
              <>
                <span className="sg-meta-item"><b>{fa(data.messageCount)}</b> پیام بررسی‌شده</span>
                <span className="sg-meta-item">بازه: <b>{WINDOWS.find((w) => w.days === active)?.label ?? "—"}</b></span>
                {faDate(data.sinceIso) && (
                  <span className="sg-meta-item">از {faDate(data.sinceIso)}</span>
                )}
                {fresh != null && (
                  <span className={`sg-fresh sg-fresh--${freshTone}`}>
                    {freshTone === "old" ? "⚠️ " : ""}به‌روزرسانی: {freshText}
                  </span>
                )}
              </>
            )}
          </div>

          {data && !data.empty && chips.length > 1 && (
            <div className="sg-chips">
              {chips.map((w) => (
                <button key={w.days} onClick={() => setDays(w.days)} disabled={loading}
                  aria-pressed={active === w.days}
                  className={`sg-chip ${active === w.days ? "is-on" : ""}`}>{w.label}</button>
              ))}
            </div>
          )}
          {data?.fellBack && (
            <div className="sg-note">
              برای بازه‌ی درخواستی گزارشی موجود نبود؛ نزدیک‌ترین بازه نمایش داده شده.
            </div>
          )}
        </div>
      </header>

      <main className="sg-wrap sg-main">
        {err && (
          <div className="sg-error" role="alert">
            <span className="sg-error-ico" aria-hidden>⚠️</span>
            <span>{err}</span>
            <button className="sg-btn" onClick={() => load(days)} disabled={loading}>
              {loading ? "در حال تلاش…" : "تلاش دوباره"}
            </button>
          </div>
        )}

        {loading && !data && !err && (
          <div className="sg-skel" aria-busy="true">
            <div className="sg-skel-txt">در حال دریافت گزارش…</div>
            {[...Array(4)].map((_, i) => <div key={i} className="sg-skel-box" />)}
          </div>
        )}

        {!loading && data?.empty && (
          <div className="sg-empty">
            <EmptyState icon="📭" title="هنوز گزارشی منتشر نشده"
              hint="برای این گروه گزارشی در دسترس نیست. بعداً دوباره سر بزن."
              action={<button className="sg-btn" onClick={() => load(days)}>تلاش دوباره</button>} />
          </div>
        )}

        {a && s && (
          <div className={loading ? "sg-dim" : ""}>
            {/* ─── PULSE: ring + KPIs ───────────────────── */}
            <section className="sg-pulse">
              <div className="sg-ring-card">
                <Ring pct={pct} />
                <div className="sg-ring-meta">
                  <div className="sg-ring-label">پیشرفت کلی</div>
                  <div className="sg-ring-sub">{fa(s.done)} از {fa(s.totalTasks)} کار انجام شده</div>
                  {s.avgCompletionHours != null && (
                    <div className="sg-ring-sub">میانگین زمان انجام: <b>{fa(Math.round(s.avgCompletionHours))}</b> ساعت</div>
                  )}
                </div>
              </div>

              <div className="sg-kpis">
                <Kpi n={s.totalTasks} label="کل کارها" tone="base" />
                <Kpi n={s.inProgress} label="در حال انجام" tone="prog" />
                <Kpi n={s.stalled} label="متوقف" tone="stall" />
                <Kpi n={s.overdue} label="معوق" tone="over" />
                <Kpi n={s.done} label="انجام‌شده" tone="done" />
                <Kpi n={a.people.length} label="افراد درگیر" tone="base" />
              </div>
            </section>

            {/* ─── DISTRIBUTION BAR ─────────────────────── */}
            {segs.length > 0 && (
              <section className="sg-card sg-dist">
                <h2 className="sg-h2">توزیع وضعیت کارها</h2>
                <div className="sg-bar">
                  {segs.map((x) => (
                    <div key={x.k} className={`sg-bar-seg sg-${x.k}`}
                      style={{ width: `${(x.v / segTotal) * 100}%` }} title={`${x.label}: ${fa(x.v)}`} />
                  ))}
                </div>
                <div className="sg-legend">
                  {segs.map((x) => (
                    <span key={x.k} className="sg-leg">
                      <i className={`sg-swatch sg-${x.k}`} />{x.label}
                      <b>{fa(x.v)}</b>
                      <em>{fa(Math.round((x.v / segTotal) * 100))}٪</em>
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* ─── CRITICAL ─────────────────────────────── */}
            {critical.length > 0 && (
              <Section icon="🆘" title="موارد بحرانی" summary={`${fa(critical.length)} مورد نیازمند رسیدگی`}
                badge={<Pill tone="bad">{fa(critical.length)}</Pill>} {...sec("crit")}>
                <div className="sg-crit-grid">
                  {critical.map((c, i) => {
                    // The analyser sometimes repeats a name; show each person once.
                    const ppl = [...new Set(c.people.map((p) => p.trim()).filter(Boolean))];
                    return (
                      <article key={i} className="sg-crit">
                        <div className="sg-crit-top">
                          <span className="sg-tag sg-tag--red">{KIND_LABEL[c.kind] ?? c.kind}</span>
                          {c.topicName && <span className="sg-tag">{c.topicName}</span>}
                        </div>
                        <h3 className="sg-crit-title" dir="auto">{c.title}</h3>
                        {c.details && <p className="sg-crit-body" dir="auto">{c.details}</p>}
                        {ppl.length > 0 && (
                          <div className="sg-faces">
                            {ppl.map((p, j) => (
                              <span key={j} className="sg-face" title={p}>{initials(p)}</span>
                            ))}
                            <span className="sg-faces-txt">{ppl.join("، ")}</span>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* ─── HIGHLIGHTS ───────────────────────────── */}
            {a.highlights.length > 0 && (
              <Section icon="🚨" title="نکات کلیدی" summary={`${fa(a.highlights.length)} مورد · ${a.highlights[0]?.title ?? ""}`}
                {...sec("hl")}>
                <div className="sg-hl-grid">
                  {a.highlights.map((h, i) => (
                    <article key={i} className={`sg-hl sg-hl--${h.kind}`}>
                      <div className="sg-hl-head">
                        <span className="sg-tag">{KIND_LABEL[h.kind] ?? h.kind}</span>
                        {h.topicName && <span className="sg-tag">{h.topicName}</span>}
                      </div>
                      <h3 dir="auto">{h.title}</h3>
                      {h.details && <p dir="auto">{h.details}</p>}
                    </article>
                  ))}
                </div>
              </Section>
            )}

            {/* ─── TASK EXPLORER ────────────────────────── */}
            {a.tasks.length > 0 && (
              <Section icon="📋" title="کارها"
                summary={`${fa(a.tasks.length)} کار · ${fa(s.done)} انجام‌شده · ${fa(lateCount)} معوق/متوقف`}
                badge={<Pill>{fa(a.tasks.length)}</Pill>} {...sec("tasks")}>
                <div className="sg-toolbar">
                  <input className="sg-search" type="search" placeholder="جستجو در عنوان، مسئول، تاپیک…"
                    aria-label="جستجو در کارها" value={q} onChange={(e) => setQ(e.target.value)} />
                  <div className="sg-filters">
                    {([
                      ["all", `همه (${fa(a.tasks.length)})`],
                      ["overdue", `معوق/متوقف (${fa(lateCount)})`],
                      ["announced", `اعلام‌شده (${fa(s.announced)})`],
                      ["in_progress", `در جریان (${fa(s.inProgress)})`],
                      ["done", `انجام‌شده (${fa(s.done)})`],
                    ] as const).map(([k, lbl]) => (
                      <button key={k} onClick={() => setFilter(k as typeof filter)}
                        aria-pressed={filter === k}
                        className={`sg-fbtn ${filter === k ? "is-on" : ""}`}>{lbl}</button>
                    ))}
                  </div>
                </div>

                {tasks.length === 0 ? (
                  <div className="sg-none">موردی پیدا نشد.</div>
                ) : (
                  <>
                    <ul className="sg-tasks">
                      {tasks.slice(0, shown).map((t, i) => (
                        <TaskRow key={i} t={t} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
                      ))}
                    </ul>
                    {tasks.length > shown && (
                      <button className="sg-more" onClick={() => setLimit((l) => l + 40)}>
                        نمایش بیشتر ({fa(tasks.length - shown)} مورد دیگر)
                      </button>
                    )}
                  </>
                )}
              </Section>
            )}

            {/* ─── TOPICS ───────────────────────────────── */}
            {a.topicBreakdown.length > 0 && (
              <Section icon="🧵" title="تفکیک بر اساس تاپیک"
                summary={`${fa(a.topicBreakdown.length)} تاپیک · ${fa(topicMsgs)} پیام`} {...sec("topics")}>
                <div className="sg-topics">
                  {[...a.topicBreakdown]
                    .sort((x, y) => y.messageCount - x.messageCount)
                    .map((t, i) => {
                      const max = Math.max(...a.topicBreakdown.map((z) => z.messageCount), 1);
                      return (
                        <article key={i} className="sg-topic">
                          <h3 dir="auto">{t.topicName}</h3>
                          <span className="sg-topic-n">{fa(t.messageCount)} پیام</span>
                          <div className="sg-tbar">
                            <div className="sg-tbar-fill" style={{ width: `${(t.messageCount / max) * 100}%` }} />
                          </div>
                          {t.summary && <p className="sg-topic-sum" dir="auto">{t.summary}</p>}
                          <div className="sg-topic-foot">
                            <span>{fa(t.activeSenders)} نفر فعال</span>
                            {t.openTasks > 0 && <span className="sg-pill sg-pill--warn">{fa(t.openTasks)} کار باز</span>}
                            {t.overdueTasks > 0 && <span className="sg-pill sg-pill--bad">{fa(t.overdueTasks)} معوق</span>}
                          </div>
                          {t.keyPoints?.length > 0 && (
                            <ul className="sg-kp">
                              {t.keyPoints.map((k, j) => <li key={j} dir="auto">{k}</li>)}
                            </ul>
                          )}
                        </article>
                      );
                    })}
                </div>
              </Section>
            )}

            {/* ─── PEOPLE ───────────────────────────────── */}
            {a.people.length > 0 && (
              <Section icon="👥" title="افراد و نقش‌ها" summary={`${fa(a.people.length)} نفر`} {...sec("people")}>
                <div className="sg-people">
                  {[...a.people]
                    .sort((x, y) => y.tasksAnnounced - x.tasksAnnounced)
                    .map((p, i) => {
                      const rate = p.tasksAnnounced > 0
                        ? Math.round((p.tasksCompleted / p.tasksAnnounced) * 100) : 0;
                      return (
                        <article key={i} className="sg-person">
                          <span className="sg-avatar" aria-hidden>{initials(p.name)}</span>
                          <h3 dir="auto">{p.name}</h3>
                          <span className="sg-tag">{ROLE_LABEL[p.roleLabel] ?? p.roleLabel}</span>
                          {p.roleDescription && <p className="sg-person-desc" dir="auto">{p.roleDescription}</p>}
                          <div className="sg-pbar">
                            <div className="sg-pbar-fill" style={{ width: `${rate}%` }} />
                          </div>
                          <div className="sg-person-stats">
                            <span>اعلام: <b>{fa(p.tasksAnnounced)}</b></span>
                            <span>انجام: <b>{fa(p.tasksCompleted)}</b></span>
                            <span className="sg-rate">{fa(rate)}٪</span>
                          </div>
                        </article>
                      );
                    })}
                </div>
              </Section>
            )}

            {a.tasks.length === 0 && (
              <div className="sg-empty">
                <EmptyState icon="📋" title="کار مشخصی در این بازه پیدا نشد."
                  hint="بازه‌ی دیگری را امتحان کن." />
              </div>
            )}

            <footer className="sg-footer">
              {data?.cachedAt && <>این گزارش در {faDate(data.cachedAt)} تولید شده است.</>}
            </footer>
          </div>
        )}
      </main>
    </div>
  );
}

/* ── pieces ─────────────────────────────────────────────── */

function Ring({ pct }: { pct: number }) {
  const R = 52, C = 2 * Math.PI * R;
  return (
    <div className="sg-ring">
      <svg viewBox="0 0 120 120" className="sg-ring-svg">
        {/* A flat single-colour arc reads as a loading spinner. The
            gradient gives the sweep a direction, so it reads as progress. */}
        <defs>
          <linearGradient id="sgRingGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2fd48f" />
            <stop offset="100%" stopColor="#6d8cff" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={R} className="sg-ring-bg" />
        <circle cx="60" cy="60" r={R} className="sg-ring-fg"
          style={{ strokeDasharray: C, strokeDashoffset: C - (C * pct) / 100 }} />
      </svg>
      <div className="sg-ring-num"><b>{fa(pct)}</b><span>٪</span></div>
    </div>
  );
}

function Kpi({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className={`sg-kpi sg-kpi--${tone}`}>
      <div className="sg-kpi-n">{fa(n)}</div>
      <div className="sg-kpi-l">{label}</div>
    </div>
  );
}

function TaskRow({ t, open, onToggle }: { t: Task; open: boolean; onToggle: () => void }) {
  const st = STATUS[t.status] ?? STATUS.announced;
  const stale = t.staleDays != null && t.staleDays >= 1 ? Math.round(t.staleDays) : 0;
  return (
    <li className={`sg-task sg-st-${st.cls} ${open ? "is-open" : ""}`}>
      <button className="sg-task-head" onClick={onToggle} aria-expanded={open}>
        <span className="sg-task-title" dir="auto">{t.title}</span>
        <span className="sg-task-tags">
          <span className={`sg-pill sg-pill--${st.pill}`}>{st.label}</span>
          {t.isOverdue && <span className="sg-pill sg-pill--bad">معوق</span>}
          {t.priority === "high" && <span className="sg-pill sg-pill--warn">مهم</span>}
          {t.owner && <span className="sg-pill">{t.owner}</span>}
          {t.topicName && <span className="sg-pill sg-pill--ghost">{t.topicName}</span>}
          <span className="sg-caret" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </span>
        </span>
      </button>
      {open && (
        <div className="sg-task-body">
          <dl className="sg-dl">
            {t.announcedBy && <div><dt>اعلام‌کننده</dt><dd dir="auto">{t.announcedBy}</dd></div>}
            {t.owner && t.owner !== t.announcedBy && <div><dt>مسئول</dt><dd dir="auto">{t.owner}</dd></div>}
            {faDate(t.dueAt) && <div><dt>مهلت</dt><dd>{faDate(t.dueAt)}</dd></div>}
            {faDate(t.completedAt) && <div><dt>تاریخ انجام</dt><dd>{faDate(t.completedAt)}</dd></div>}
            {stale > 0 && <div><dt>بدون تحرک</dt><dd>{fa(stale)} روز</dd></div>}
          </dl>
          {t.blockedReason && <p className="sg-block" dir="auto">⛔ {t.blockedReason}</p>}
          {t.evidence?.length > 0 && (
            <ul className="sg-ev">
              {normalizeEvidence(t.evidence).slice(0, 3).map((e, i) => (
                <li key={i}>
                  {e.speaker && <b className="sg-ev-who" dir="auto">{e.speaker}</b>}
                  <span className="sg-ev-q" dir="auto">«{e.text}»</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
