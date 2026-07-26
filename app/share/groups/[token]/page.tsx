"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import type { Analysis, Task, TaskStatus } from "@/components/GroupAnalyticsView";
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
  done: { label: "انجام‌شده", cls: "done" },
  in_progress: { label: "در حال انجام", cls: "prog" },
  stalled: { label: "متوقف", cls: "stall" },
  announced: { label: "اعلام‌شده", cls: "ann" },
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

  const load = useCallback(async (w: number) => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/public/groups/${token}?days=${w}`);
      const j = (await r.json()) as PublicResponse;
      if (!r.ok) throw new Error(j.error ?? "دریافت گزارش ناموفق بود");
      setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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

  return (
    <div className="sg" dir="rtl">
      <style dangerouslySetInnerHTML={{ __html: SHARE_CSS }} />

      {/* ─── HERO ─────────────────────────────────────────── */}
      <header className="sg-hero">
        <div className="sg-hero-glow" aria-hidden />
        <div className="sg-wrap">
          <div className="sg-eyebrow">گزارش گروه · فقط‌خواندنی</div>
          <h1 className="sg-title">{data?.chatTitle ?? "گزارش گروه"}</h1>

          {a?.overview && <p className="sg-overview">{a.overview}</p>}

          <div className="sg-meta">
            {data && !data.empty && (
              <>
                <span className="sg-meta-item"><b>{fa(data.messageCount)}</b> پیام بررسی‌شده</span>
                <span className="sg-dot" />
                <span className="sg-meta-item">بازه: <b>{WINDOWS.find((w) => w.days === active)?.label ?? "—"}</b></span>
                {faDate(data.sinceIso) && (
                  <>
                    <span className="sg-dot" />
                    <span className="sg-meta-item">از {faDate(data.sinceIso)}</span>
                  </>
                )}
                {fresh != null && (
                  <span className={`sg-fresh sg-fresh--${freshTone}`}>
                    {freshTone === "old" ? "⚠️ " : ""}به‌روزرسانی: {freshText}
                  </span>
                )}
              </>
            )}
          </div>

          {chips.length > 1 && (
            <div className="sg-chips">
              {chips.map((w) => (
                <button key={w.days} onClick={() => setDays(w.days)} disabled={loading}
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
          <div className="sg-error">
            <span>{err}</span>
            <button className="sg-btn" onClick={() => load(days)}>تلاش دوباره</button>
          </div>
        )}

        {loading && !data && (
          <div className="sg-skel">
            {[...Array(4)].map((_, i) => <div key={i} className="sg-skel-box" />)}
          </div>
        )}

        {!loading && data?.empty && (
          <div className="sg-empty">
            <div className="sg-empty-ico">📭</div>
            <h3>هنوز گزارشی منتشر نشده</h3>
            <p>برای این گروه گزارشی در دسترس نیست. بعداً دوباره سر بزن.</p>
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
                      style={{ width: `${(x.v / segTotal) * 100}%` }} title={`${x.label}: ${x.v}`} />
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
              <section className="sg-sec">
                <h2 className="sg-h2"><span className="sg-h2-ico">🆘</span>موارد بحرانی</h2>
                <div className="sg-crit-grid">
                  {critical.map((c, i) => (
                    <article key={i} className="sg-crit">
                      <div className="sg-crit-top">
                        <span className="sg-tag sg-tag--red">{KIND_LABEL[c.kind] ?? c.kind}</span>
                        {c.topicName && <span className="sg-tag">{c.topicName}</span>}
                      </div>
                      <h3 className="sg-crit-title">{c.title}</h3>
                      {c.details && <p className="sg-crit-body">{c.details}</p>}
                      {(() => {
                        // The analyser sometimes repeats a name; show each person once.
                        const ppl = [...new Set(c.people.map((p) => p.trim()).filter(Boolean))];
                        if (ppl.length === 0) return null;
                        return (
                          <div className="sg-faces">
                            {ppl.map((p, j) => (
                              <span key={j} className="sg-face" title={p}>{initials(p)}</span>
                            ))}
                            <span className="sg-faces-txt">{ppl.join("، ")}</span>
                          </div>
                        );
                      })()}
                    </article>
                  ))}
                </div>
              </section>
            )}

            {/* ─── HIGHLIGHTS ───────────────────────────── */}
            {a.highlights.length > 0 && (
              <section className="sg-sec">
                <h2 className="sg-h2"><span className="sg-h2-ico">🚨</span>نکات کلیدی</h2>
                <div className="sg-hl-grid">
                  {a.highlights.map((h, i) => (
                    <article key={i} className={`sg-hl sg-hl--${h.kind}`}>
                      <div className="sg-hl-head">
                        <span className="sg-tag">{KIND_LABEL[h.kind] ?? h.kind}</span>
                        {h.topicName && <span className="sg-hl-topic">{h.topicName}</span>}
                      </div>
                      <h3>{h.title}</h3>
                      {h.details && <p>{h.details}</p>}
                    </article>
                  ))}
                </div>
              </section>
            )}

            {/* ─── PEOPLE ───────────────────────────────── */}
            {a.people.length > 0 && (
              <section className="sg-sec">
                <h2 className="sg-h2"><span className="sg-h2-ico">👥</span>افراد و نقش‌ها</h2>
                <div className="sg-people">
                  {[...a.people]
                    .sort((x, y) => y.tasksAnnounced - x.tasksAnnounced)
                    .map((p, i) => {
                      const rate = p.tasksAnnounced > 0
                        ? Math.round((p.tasksCompleted / p.tasksAnnounced) * 100) : 0;
                      return (
                        <article key={i} className="sg-person">
                          <span className="sg-avatar">{initials(p.name)}</span>
                          <div className="sg-person-main">
                            <div className="sg-person-row">
                              <h3>{p.name}</h3>
                              <span className="sg-tag">{ROLE_LABEL[p.roleLabel] ?? p.roleLabel}</span>
                            </div>
                            {p.roleDescription && <p className="sg-person-desc">{p.roleDescription}</p>}
                            <div className="sg-pbar">
                              <div className="sg-pbar-fill" style={{ width: `${rate}%` }} />
                            </div>
                            <div className="sg-person-stats">
                              <span>اعلام: <b>{fa(p.tasksAnnounced)}</b></span>
                              <span>انجام: <b>{fa(p.tasksCompleted)}</b></span>
                              <span className="sg-rate">{fa(rate)}٪</span>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                </div>
              </section>
            )}

            {/* ─── TOPICS ───────────────────────────────── */}
            {a.topicBreakdown.length > 0 && (
              <section className="sg-sec">
                <h2 className="sg-h2"><span className="sg-h2-ico">🧵</span>تفکیک بر اساس تاپیک</h2>
                <div className="sg-topics">
                  {[...a.topicBreakdown]
                    .sort((x, y) => y.messageCount - x.messageCount)
                    .map((t, i) => {
                      const max = Math.max(...a.topicBreakdown.map((z) => z.messageCount), 1);
                      return (
                        <article key={i} className="sg-topic">
                          <div className="sg-topic-head">
                            <h3>{t.topicName}</h3>
                            <span className="sg-topic-n">{fa(t.messageCount)} پیام</span>
                          </div>
                          <div className="sg-tbar">
                            <div className="sg-tbar-fill" style={{ width: `${(t.messageCount / max) * 100}%` }} />
                          </div>
                          {t.summary && <p className="sg-topic-sum">{t.summary}</p>}
                          <div className="sg-topic-foot">
                            <span>{fa(t.activeSenders)} نفر فعال</span>
                            {t.openTasks > 0 && <span className="sg-pill sg-pill--warn">{fa(t.openTasks)} کار باز</span>}
                            {t.overdueTasks > 0 && <span className="sg-pill sg-pill--bad">{fa(t.overdueTasks)} معوق</span>}
                          </div>
                          {t.keyPoints?.length > 0 && (
                            <ul className="sg-kp">
                              {t.keyPoints.map((k, j) => <li key={j}>{k}</li>)}
                            </ul>
                          )}
                        </article>
                      );
                    })}
                </div>
              </section>
            )}

            {/* ─── TASK EXPLORER ────────────────────────── */}
            {a.tasks.length > 0 && (
              <section className="sg-sec">
                <h2 className="sg-h2"><span className="sg-h2-ico">📋</span>کارها</h2>
                <div className="sg-toolbar">
                  <input className="sg-search" placeholder="جستجو در عنوان، مسئول، تاپیک…"
                    value={q} onChange={(e) => setQ(e.target.value)} />
                  <div className="sg-filters">
                    {([
                      ["all", `همه (${fa(a.tasks.length)})`],
                      ["overdue", `معوق/متوقف (${fa(a.tasks.filter((t) => t.isOverdue || t.status === "stalled").length)})`],
                      ["in_progress", `در جریان (${fa(s.inProgress)})`],
                      ["done", `انجام‌شده (${fa(s.done)})`],
                    ] as const).map(([k, lbl]) => (
                      <button key={k} onClick={() => setFilter(k as typeof filter)}
                        className={`sg-fbtn ${filter === k ? "is-on" : ""}`}>{lbl}</button>
                    ))}
                  </div>
                </div>

                {tasks.length === 0 ? (
                  <div className="sg-none">موردی پیدا نشد.</div>
                ) : (
                  <>
                    <ul className="sg-tasks">
                      {tasks.slice(0, limit).map((t, i) => (
                        <TaskRow key={i} t={t} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
                      ))}
                    </ul>
                    {tasks.length > limit && (
                      <button className="sg-more" onClick={() => setLimit((l) => l + 40)}>
                        نمایش بیشتر ({fa(tasks.length - limit)} مورد دیگر)
                      </button>
                    )}
                  </>
                )}
              </section>
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
  const late = t.isOverdue || t.status === "stalled";
  const has = !!(t.blockedReason || t.evidence?.length || t.dueAt || t.completedAt);
  return (
    <li className={`sg-task ${open ? "is-open" : ""}`}>
      <button className="sg-task-head" onClick={onToggle} aria-expanded={open}>
        <span className={`sg-dotst sg-${st.cls}`} />
        <span className="sg-task-title">{t.title}</span>
        <span className="sg-task-tags">
          {late && <span className="sg-pill sg-pill--bad">معوق</span>}
          {t.priority === "high" && <span className="sg-pill sg-pill--warn">مهم</span>}
          {t.owner && <span className="sg-pill">{t.owner}</span>}
          {t.topicName && <span className="sg-pill sg-pill--ghost">{t.topicName}</span>}
        </span>
        {has && <span className="sg-caret">{open ? "▲" : "▼"}</span>}
      </button>
      {open && has && (
        <div className="sg-task-body">
          <dl className="sg-dl">
            <div><dt>وضعیت</dt><dd>{st.label}</dd></div>
            {t.announcedBy && <div><dt>اعلام‌کننده</dt><dd>{t.announcedBy}</dd></div>}
            {faDate(t.dueAt) && <div><dt>مهلت</dt><dd>{faDate(t.dueAt)}</dd></div>}
            {faDate(t.completedAt) && <div><dt>تاریخ انجام</dt><dd>{faDate(t.completedAt)}</dd></div>}
            {t.staleDays != null && t.staleDays > 0 && (
              <div><dt>بدون تحرک</dt><dd>{fa(t.staleDays)} روز</dd></div>
            )}
          </dl>
          {t.blockedReason && <p className="sg-block">⛔ {t.blockedReason}</p>}
          {t.evidence?.length > 0 && (
            <ul className="sg-ev">
              {t.evidence.slice(0, 3).map((e, i) => <li key={i}>«{e}»</li>)}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
