"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import Section from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/Dialogs";

type Tenant = {
  id: number;
  name: string;
  plan: string;
  hikerBudgetUsd: number;
  hikerApprovedUsd: number;
  hikerApprovalStepUsd: number;
  monitoredCap: number;
  isEnabled: boolean;
  notes: string | null;
  hikerKeyName: string | null;
  hikerKeyPrefix: string | null;
  openrouterKeyPrefix: string | null;
  groqKeyPrefix: string | null;
  spentUsd: number;
  createdAt: string;
  updatedAt: string;
};

type AdminUser = {
  userId: number;
  username: string | null;
  firstName: string | null;
  addedAt: string;
  addedBy: number | null;
};

type Connection = {
  id: string;
  userId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  canReply: boolean;
  isEnabled: boolean;
  tenantId: number | null;
  updatedAt: string;
};

type PlanPreset = {
  key: string;
  label: string;
  hikerBudgetUsd: number;
  hikerApprovalStepUsd: number;
  monitoredCap: number;
  description: string;
};

type Window = { calls: number; costUsd: number };
type Bucket = { at: string; calls: number; costUsd: number };
type HikerCall = {
  id: number;
  calledAt: string;
  endpoint: string;
  costUsd: number;
  accountId: number | null;
};
type Finance = {
  tenant: { id: number; name: string; plan: string };
  state: {
    spentUsd: number;
    approvedUsd: number;
    budgetUsd: number;
    stepUsd: number;
    nextThresholdUsd: number;
  };
  summary: {
    lastHour: Window;
    today: Window;
    last7d: Window;
    last30d: Window;
    allTime: Window;
  };
  hourly: Bucket[];
  daily: Bucket[];
  weekly: Bucket[];
  monthly: Bucket[];
  recent: HikerCall[];
};

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

// Shared control styles: every control is >= 40 px tall (44 for fields) so it works with a thumb.
const field = "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 py-2 disabled:opacity-60";
const btn = "min-h-10 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)] disabled:opacity-50";
const btnPrimary = "min-h-11 px-5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50";
const btnOk = "min-h-10 px-4 rounded-xl border border-emerald-700 text-emerald-300 text-sm hover:bg-emerald-900/30 disabled:opacity-50";
const btnWarn = "min-h-10 px-4 rounded-xl border border-amber-700 text-amber-300 text-sm hover:bg-amber-900/30 disabled:opacity-50";
const btnDanger = "min-h-10 px-4 rounded-xl border border-red-800 text-red-300 text-sm hover:bg-red-900/30 disabled:opacity-50";

// Money keeps Latin digits (it is a $ amount) but is isolated so it does not scramble inside Persian text.
const usd = (n: number, d = 2) => <bdi dir="ltr">${n.toFixed(d)}</bdi>;

// Bottom sheet on phones, centred dialog on desktop; the body scrolls, the footer (actions) stays visible.
function Sheet({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? "md:max-w-3xl" : "md:max-w-2xl"} max-h-[92dvh] flex flex-col rounded-t-3xl md:rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl`}
      >
        <div className="px-5 pt-5 pb-3 text-center border-b border-[var(--color-border)]">
          <h2 className="text-base font-semibold [overflow-wrap:anywhere]">{title}</h2>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 text-center [overflow-wrap:anywhere]">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-[var(--color-border)]">{footer}</div>}
      </div>
    </div>
  );
}

// label + explanation + 52 px switch (same markup as the settings page).
function SwitchRow({ label, hint, checked, onChange }: { label: ReactNode; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 min-h-14 py-2.5 px-3 rounded-xl bg-[var(--color-surface-2)] cursor-pointer">
      <span className="min-w-0 flex-1 text-center">
        <span className="block text-sm leading-6">{label}</span>
        {hint && <span className="block text-xs leading-6 text-[var(--color-text-dim)]">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className="relative shrink-0 w-[52px] h-8 rounded-full bg-[var(--color-border)] transition-colors peer-checked:bg-[var(--color-accent)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-accent)] after:content-[''] after:absolute after:top-1 after:left-1 after:w-6 after:h-6 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
      />
    </label>
  );
}

function FieldBox({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm leading-6">{label}</span>
      {children}
    </label>
  );
}

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [plans, setPlans] = useState<PlanPreset[]>([]);
  const [tab, setTab] = useState<
    "tenants" | "admins" | "connections" | "external"
  >("tenants");
  type ExternalStatus = {
    config: { enabled: boolean; baseUrl: string | null; secretConfigured: boolean };
    health: { ok: boolean; status: number; body: string; baseUrl: string | null };
    stats: {
      activeSubscriptions: number;
      totalSubscriptions: number;
      totalNotificationsReceived: number;
    };
    subscriptions: Array<{
      username: string;
      registeredAt: string;
      unregisteredAt: string | null;
      lastPushedAt: string | null;
      lastStatus: number | null;
      lastNotifiedAt: string | null;
      notifyCount: number;
    }>;
  };
  const [external, setExternal] = useState<ExternalStatus | null>(null);
  const [externalLoading, setExternalLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  type SyncResult = {
    total: number;
    succeeded: number;
    failed: number;
    errors: Array<{ username: string; status: number; body: string }>;
  };
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [creating, setCreating] = useState(false);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [financeBusy, setFinanceBusy] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulking, setBulking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setAccessDenied(false);
    setLoadError(null);
    try {
      const me = await fetch("/api/admin/me");
      const meJ = (await me.json()) as { admin?: boolean };
      if (!meJ.admin) {
        setAccessDenied(true);
        return;
      }
      const [t, a, c, p] = await Promise.all([
        fetch("/api/admin/tenants"),
        fetch("/api/admin/admins"),
        fetch("/api/admin/connections"),
        fetch("/api/admin/tenants/0/apply-plan"),
      ]);
      if (t.ok) {
        const j = (await t.json()) as { tenants: Tenant[] };
        setTenants(j.tenants);
      } else {
        setLoadError(`بارگذاری tenantها ناموفق بود (${t.status})`);
      }
      if (a.ok) {
        const j = (await a.json()) as { admins: AdminUser[] };
        setAdmins(j.admins);
      }
      if (c.ok) {
        const j = (await c.json()) as { connections: Connection[] };
        setConnections(j.connections);
      }
      if (p.ok) {
        const j = (await p.json()) as { presets: PlanPreset[] };
        setPlans(j.presets);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab !== "external" || external != null) return;
    setExternalLoading(true);
    fetch("/api/admin/external-monitor")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ExternalStatus | null) => {
        if (j) setExternal(j);
      })
      .finally(() => setExternalLoading(false));
  }, [tab, external]);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runBulk(op: string, plan?: string) {
    if (selected.size === 0) return;
    if (op === "delete" && !(await confirmDialog(`${fa(selected.size)} tenant حذف بشن؟`, { danger: true, confirmLabel: "حذف" })))
      return;
    setBulking(true);
    try {
      const r = await fetch("/api/admin/tenants/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, ids: [...selected], plan }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        succeeded?: number;
        errors?: Array<{ id: number; error: string }>;
      };
      if (j.errors && j.errors.length > 0) {
        setNotice(
          `${fa(j.succeeded ?? 0)} موفق · ${fa(j.errors.length)} خطا:\n` +
            j.errors.map((e) => `${e.id}: ${e.error}`).join("\n"),
        );
      }
      setSelected(new Set());
      await load();
    } finally {
      setBulking(false);
    }
  }

  async function openFinance(tenantId: number) {
    setFinance(null);
    setFinanceBusy(tenantId);
    try {
      const r = await fetch(`/api/admin/tenants/${tenantId}/finance`);
      if (r.ok) {
        const j = (await r.json()) as Finance;
        setFinance(j);
      } else {
        setNotice("خطا در بارگذاری");
      }
    } finally {
      setFinanceBusy(null);
    }
  }

  async function removeAdmin(a: AdminUser) {
    if (!(await confirmDialog(`حذف admin ${a.userId}؟`, { danger: true, confirmLabel: "حذف" }))) return;
    const r = await fetch(`/api/admin/admins/${a.userId}`, {
      method: "DELETE",
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
      };
      setNotice(j.error ?? "خطا");
    } else {
      await load();
    }
  }

  if (loading) {
    return (
      <Shell>
        <PageTitle title="🛠 Admin" subtitle="در حال بارگذاری…" />
      </Shell>
    );
  }
  if (accessDenied) {
    return (
      <Shell>
        <PageTitle title="🛠 Admin" subtitle="" />
        <Card>
          <p className="text-sm leading-7 text-red-300">
            ⛔ دسترسی نداری. ADMIN_USER_IDS رو توی env ست کن یا از یکی از
            admin‌های فعلی بخواه اضافه‌ت کنه.
          </p>
        </Card>
      </Shell>
    );
  }

  const tabs = [
    ["tenants", "🏢 مستأجرها", tenants.length],
    ["admins", "👮 مدیرها", admins.length],
    ["connections", "🔗 اتصال‌ها", connections.length],
    ["external", "🛰 پایش خارجی", external?.stats.activeSubscriptions ?? 0],
  ] as const;

  return (
    <Shell>
      <PageTitle
        title="🛠 Admin"
        subtitle="مدیریت tenantها، حساب‌کتاب مالی، کلیدهای API، و assign کردن business_connectionها"
      />

      {loadError && (
        <Card className="mb-3 !border-red-800 !bg-red-900/20">
          <p className="text-sm text-red-200">{loadError}</p>
          <button onClick={load} className={`${btn} mt-3`}>تلاش دوباره</button>
        </Card>
      )}

      {notice && (
        <div role="alert" className="mb-3 rounded-2xl border border-amber-700 bg-amber-900/20 px-4 py-3 text-center">
          <p className="text-sm leading-7 text-amber-100 whitespace-pre-line">{notice}</p>
          <button onClick={() => setNotice(null)} className={`${btn} mt-2`}>بستن</button>
        </div>
      )}

      <div role="tablist" className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-12 px-2 rounded-xl border text-sm ${
              tab === key
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15"
                : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            {label} <span className="text-xs tabular-nums opacity-70">({fa(count)})</span>
          </button>
        ))}
      </div>

      {tab === "tenants" && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button onClick={() => setCreating(true)} className={btnPrimary}>
              ➕ tenant جدید
            </button>
            {tenants.length > 0 && (
              <>
                <button onClick={() => setSelected(new Set(tenants.map((t) => t.id)))} className={btn}>
                  انتخاب همه
                </button>
                <button onClick={() => setSelected(new Set())} disabled={selected.size === 0} className={btn}>
                  پاک کردن
                </button>
              </>
            )}
          </div>

          {tenants.length === 0 && !loadError && (
            <EmptyState
              icon="🏢"
              title="هنوز tenantی نیست"
              hint="با «tenant جدید» اولین مستأجر رو بساز؛ بعد اتصال‌های business رو بهش assign کن."
              action={<button onClick={() => setCreating(true)} className={btnPrimary}>➕ tenant جدید</button>}
            />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {tenants.map((t) => {
              const pct =
                t.hikerBudgetUsd > 0
                  ? Math.min(100, (t.spentUsd / t.hikerBudgetUsd) * 100)
                  : 0;
              const approvedPct =
                t.hikerBudgetUsd > 0
                  ? Math.min(100, (t.hikerApprovedUsd / t.hikerBudgetUsd) * 100)
                  : 0;
              const keyChip = "rounded-lg bg-[var(--color-surface-2)] px-2 py-1 text-xs";
              return (
                <Card key={t.id} className={!t.isEnabled ? "opacity-60" : ""}>
                  <div className="flex items-center gap-2 mb-2">
                    <label className="grid place-items-center w-11 h-11 shrink-0 cursor-pointer" aria-label={`انتخاب ${t.name}`}>
                      <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} />
                    </label>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-semibold [overflow-wrap:anywhere]">{t.name}</div>
                      <div className="mt-1 flex items-center justify-center gap-1.5 flex-wrap">
                        <Badge tone={t.isEnabled ? "success" : "neutral"}>
                          {t.isEnabled ? "فعال" : "غیرفعال"}
                        </Badge>
                        <Badge tone="info">{t.plan}</Badge>
                      </div>
                    </div>
                    <span aria-hidden className="w-11 shrink-0" />
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div>
                      <div className="text-xs text-[var(--color-text-dim)]">خرج</div>
                      <div className="text-sm font-semibold tabular-nums">{usd(t.spentUsd, 4)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--color-text-dim)]">مجاز</div>
                      <div className="text-sm font-semibold tabular-nums">{usd(t.hikerApprovedUsd)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--color-text-dim)]">سقف</div>
                      <div className="text-sm font-semibold tabular-nums">{usd(t.hikerBudgetUsd)}</div>
                    </div>
                  </div>
                  <div className="h-2 bg-[var(--color-surface-2)] rounded-full overflow-hidden relative">
                    <div className="absolute inset-y-0 left-0 bg-emerald-600/40" style={{ width: `${approvedPct}%` }} />
                    <div
                      className={`absolute inset-y-0 left-0 ${
                        pct >= 100 ? "bg-red-500" : pct >= approvedPct ? "bg-amber-500" : "bg-[var(--color-accent)]"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-1 text-xs text-[var(--color-text-dim)]">
                    {fa(pct.toFixed(1))}٪ از سقف · step {usd(t.hikerApprovalStepUsd)}
                  </div>

                  <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                    <span className={keyChip}>
                      monitored cap: <strong>{fa(t.monitoredCap)}</strong>
                    </span>
                    {t.hikerKeyPrefix ? (
                      <span dir="ltr" className={keyChip}>
                        Hiker: {t.hikerKeyName ? `[${t.hikerKeyName}] ` : ""}
                        <span className="font-mono">{t.hikerKeyPrefix}</span>
                      </span>
                    ) : (
                      <span className={`${keyChip} text-amber-400`}>Hiker: (fallback)</span>
                    )}
                    {t.openrouterKeyPrefix ? (
                      <span dir="ltr" className={keyChip}>
                        OR: <span className="font-mono">{t.openrouterKeyPrefix}</span>
                      </span>
                    ) : (
                      <span className={`${keyChip} text-amber-400`}>OR: (fallback)</span>
                    )}
                    {t.groqKeyPrefix ? (
                      <span dir="ltr" className={keyChip}>
                        Groq: <span className="font-mono">{t.groqKeyPrefix}</span>
                      </span>
                    ) : (
                      <span className={`${keyChip} text-amber-400`}>Groq: (fallback)</span>
                    )}
                  </div>
                  {t.notes && (
                    <div className="text-xs leading-6 mt-3 text-[var(--color-text-dim)]">📝 {t.notes}</div>
                  )}

                  <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex flex-wrap gap-2">
                    <button
                      onClick={() => openFinance(t.id)}
                      disabled={financeBusy === t.id}
                      className={btnOk}
                      title="جزئیات مالی و چارت‌ها"
                    >
                      {financeBusy === t.id ? "…" : "📊 جزئیات مالی"}
                    </button>
                    <a
                      href={`/settings/edit?tenant=${t.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${btn} inline-flex items-center`}
                      title="همه‌ی تنظیمات (مدل، owner، auto-reply، ...) per-tenant"
                    >
                      ⚙️ تنظیمات
                    </a>
                    <button onClick={() => setEditing(t)} className={btn}>
                      ✏️ ویرایش
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Bulk actions follow the selection: pinned above the mobile tab bar so they are reachable from any scroll position. */}
          {selected.size > 0 && (
            <div className="sticky bottom-[4.5rem] md:bottom-3 z-10 mt-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 shadow-lg text-center">
              <div className="text-sm mb-2">{fa(selected.size)} انتخاب شده</div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => runBulk("enable")} disabled={bulking} className={btnOk}>
                  ▶ روشن
                </button>
                <button onClick={() => runBulk("disable")} disabled={bulking} className={btn}>
                  ⏸ خاموش
                </button>
                <select
                  disabled={bulking}
                  defaultValue=""
                  aria-label="اعمال plan"
                  onChange={(e) => {
                    if (!e.target.value) return;
                    runBulk("apply-plan", e.target.value);
                    e.currentTarget.value = "";
                  }}
                  className="min-h-10 px-3 rounded-xl text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)]"
                >
                  <option value="">📋 اعمال plan…</option>
                  {plans.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={async () => {
                    if (!(await confirmDialog(`خرج محلی ${fa(selected.size)} tenant ریست بشه؟`, { confirmLabel: "ریست" }))) return;
                    runBulk("reset-spend");
                  }}
                  disabled={bulking}
                  className={btnWarn}
                >
                  🔁 ریست خرج محلی
                </button>
                <button onClick={() => runBulk("delete")} disabled={bulking} className={btnDanger}>
                  🗑 حذف
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "admins" && (
        <>
          <Section icon="➕" title="افزودن admin" summary="با user id تلگرام (username اختیاری)">
            <AdminAddForm onSaved={load} />
          </Section>
          {admins.length === 0 ? (
            <EmptyState icon="👮" title="هنوز adminی ثبت نشده" hint="از بخش «افزودن admin» بالا یکی اضافه کن." />
          ) : (
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              {admins.map((a) => (
                <div key={a.userId} className="flex items-center gap-3 min-h-16 px-4 py-2.5 border-t first:border-t-0 border-[var(--color-border)]">
                  <div className="min-w-0 flex-1 text-center">
                    <div className="text-sm">
                      <span dir="ltr" className="font-mono">{a.userId}</span>
                      {a.username && <span dir="ltr" className="ms-2">@{a.username}</span>}
                    </div>
                    <div className="text-xs text-[var(--color-text-dim)] [overflow-wrap:anywhere]">
                      {a.firstName ? `${a.firstName} · ` : ""}
                      {new Date(a.addedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button onClick={() => removeAdmin(a)} className={`${btnDanger} px-3`} aria-label={`حذف admin ${a.userId}`}>
                    🗑
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "connections" && (
        connections.length === 0 ? (
          <EmptyState icon="🔗" title="هنوز اتصالی نیست" hint="وقتی کسی بات رو به Telegram Business وصل کنه، اینجا میاد و می‌تونی به tenant assign کنی." />
        ) : (
          <div className="flex flex-col gap-3">
            {connections.map((c) => (
              <Card key={c.id}>
                <div className="text-sm font-medium [overflow-wrap:anywhere]">
                  {[c.firstName, c.lastName].filter(Boolean).join(" ") ||
                    c.username ||
                    `user ${c.userId}`}
                </div>
                <div className="mt-1 flex items-center justify-center gap-2 flex-wrap text-xs text-[var(--color-text-dim)]">
                  {c.username && <span dir="ltr">@{c.username}</span>}
                  <span>uid {c.userId}</span>
                  {!c.isEnabled && <Badge tone="neutral">غیرفعال</Badge>}
                  {c.canReply && <Badge tone="success">قابل پاسخ</Badge>}
                </div>
                <select
                  value={c.tenantId ?? ""}
                  aria-label="tenant این اتصال"
                  onChange={async (e) => {
                    const tenantId = Number(e.target.value);
                    if (!Number.isFinite(tenantId)) return;
                    const r = await fetch(
                      `/api/admin/connections/${encodeURIComponent(c.id)}`,
                      {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ tenantId }),
                      },
                    );
                    if (!r.ok) setNotice("خطا");
                    else await load();
                  }}
                  className={`${field} mt-3`}
                >
                  <option value="">— انتخاب tenant —</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === "external" && (
        <ExternalMonitorPanel
          data={external}
          loading={externalLoading}
          syncing={syncing}
          onReload={async () => {
            setExternalLoading(true);
            try {
              const r = await fetch("/api/admin/external-monitor");
              if (r.ok) {
                const j = (await r.json()) as ExternalStatus;
                setExternal(j);
              }
            } finally {
              setExternalLoading(false);
            }
          }}
          syncResult={syncResult}
          onDismissSync={() => setSyncResult(null)}
          onSync={async () => {
            setSyncing(true);
            setSyncResult(null);
            try {
              const r = await fetch("/api/admin/external-monitor/sync", {
                method: "POST",
              });
              const j = (await r.json().catch(() => ({}))) as {
                total?: number;
                succeeded?: number;
                failed?: number;
                errors?: Array<{ username: string; status: number; body: string }>;
              };
              setSyncResult({
                total: j.total ?? 0,
                succeeded: j.succeeded ?? 0,
                failed: j.failed ?? 0,
                errors: j.errors ?? [],
              });
              const r2 = await fetch("/api/admin/external-monitor");
              if (r2.ok) setExternal((await r2.json()) as ExternalStatus);
            } finally {
              setSyncing(false);
            }
          }}
        />
      )}

      {creating && (
        <TenantEditDialog
          tenant={null}
          plans={plans}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}
      {editing && (
        <TenantEditDialog
          tenant={editing}
          plans={plans}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      {finance && (
        <FinanceDialog finance={finance} onClose={() => setFinance(null)} />
      )}
    </Shell>
  );
}

function AdminAddForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <input
        dir="ltr"
        type="text"
        inputMode="numeric"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        placeholder="Telegram user_id (عدد)"
        aria-label="Telegram user_id"
        className={field}
      />
      <input
        dir="ltr"
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="username (اختیاری)"
        aria-label="username"
        className={field}
      />
      {err && <p className="text-sm text-red-300">{err}</p>}
      <div>
        <button
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const r = await fetch("/api/admin/admins", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  userId: Number(userId),
                  username: username || undefined,
                }),
              });
              if (!r.ok) {
                const j = (await r.json().catch(() => ({}))) as { error?: string };
                setErr(j.error ?? "خطا");
              } else {
                setUserId("");
                setUsername("");
                await onSaved();
              }
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy || !userId.trim()}
          className={btnPrimary}
        >
          ➕ افزودن admin
        </button>
      </div>
    </div>
  );
}

function TenantEditDialog(props: {
  tenant: Tenant | null;
  plans: PlanPreset[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { tenant, plans, onClose, onSaved } = props;
  const [name, setName] = useState(tenant?.name ?? "");
  const [plan, setPlan] = useState(tenant?.plan ?? "starter");
  const [budget, setBudget] = useState(String(tenant?.hikerBudgetUsd ?? 50));
  const [approved, setApproved] = useState(
    String(tenant?.hikerApprovedUsd ?? 10),
  );
  const [step, setStep] = useState(String(tenant?.hikerApprovalStepUsd ?? 2));
  const [cap, setCap] = useState(String(tenant?.monitoredCap ?? 50));
  const [isEnabled, setIsEnabled] = useState(tenant?.isEnabled ?? true);
  const [notes, setNotes] = useState(tenant?.notes ?? "");
  const [hikerKey, setHikerKey] = useState("");
  const [hikerKeyName, setHikerKeyName] = useState(tenant?.hikerKeyName ?? "");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function applyPreset(key: string) {
    const p = plans.find((x) => x.key === key);
    if (!p) return;
    setPlan(p.key);
    setBudget(String(p.hikerBudgetUsd));
    setStep(String(p.hikerApprovalStepUsd));
    setCap(String(p.monitoredCap));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        name,
        plan,
        hikerBudgetUsd: Number(budget),
        hikerApprovedUsd: Number(approved),
        hikerApprovalStepUsd: Number(step),
        monitoredCap: Number(cap),
        isEnabled,
        notes,
        hikerApiKeyName: hikerKeyName || null,
      };
      if (hikerKey.trim()) body.hikerApiKey = hikerKey.trim();
      if (openrouterKey.trim()) body.openrouterApiKey = openrouterKey.trim();
      if (groqKey.trim()) body.groqApiKey = groqKey.trim();
      const url = tenant
        ? `/api/admin/tenants/${tenant.id}`
        : "/api/admin/tenants";
      const method = tenant ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? "خطا");
        return;
      }
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function resetSpend(t: Tenant) {
    if (!(await confirmDialog("کل خرج محلی این tenant ریست بشه؟", { confirmLabel: "ریست" }))) return;
    const r = await fetch(`/api/admin/tenants/${t.id}/reset-spend`, { method: "POST" });
    if (r.ok) {
      await onSaved();
    } else setErr("خطا");
  }

  async function deleteTenant(t: Tenant) {
    if (!(await confirmDialog(`حذف کامل ${t.name}؟ همه‌ی monitored / usage پاک می‌شه.`, { danger: true, confirmLabel: "حذف" }))) return;
    const r = await fetch(`/api/admin/tenants/${t.id}`, { method: "DELETE" });
    if (r.ok) {
      await onSaved();
    } else {
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
      };
      setErr(j.error ?? "خطا");
    }
  }

  return (
    <Sheet
      title={tenant ? `✏️ ویرایش ${tenant.name}` : "➕ tenant جدید"}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button onClick={onClose} className={btn}>
            لغو
          </button>
          <button onClick={save} disabled={busy || !name.trim()} className={btnPrimary}>
            {busy ? "ذخیره…" : "💾 ذخیره"}
          </button>
        </div>
      }
    >
      {err && (
        <p role="alert" className="mb-3 rounded-xl border border-red-800 bg-red-900/20 px-3 py-2 text-sm text-red-200">{err}</p>
      )}

      <div className="mb-4">
        <div className="text-sm font-medium mb-2">📋 Plan preset</div>
        <div className="flex gap-2 flex-wrap justify-center">
          {plans.map((p) => (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              className={`min-h-10 px-3 rounded-xl border text-sm ${
                plan === p.key
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15"
                  : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              }`}
              title={p.description}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="text-xs leading-6 text-[var(--color-text-dim)] mt-1.5">
          preset مقادیر سقف + step + cap رو ست می‌کنه — می‌تونی دستی هم override کنی
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <FieldBox label="نام">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </FieldBox>
        <FieldBox label="plan">
          <input type="text" dir="ltr" value={plan} onChange={(e) => setPlan(e.target.value)} className={field} />
        </FieldBox>
        <FieldBox label="سقف بودجه ($)">
          <input type="number" dir="ltr" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} className={field} />
        </FieldBox>
        <FieldBox label="مجاز فعلی ($)">
          <input type="number" dir="ltr" step="0.01" value={approved} onChange={(e) => setApproved(e.target.value)} className={field} />
        </FieldBox>
        <FieldBox label="step تخصیص ($)">
          <input type="number" dir="ltr" step="0.01" value={step} onChange={(e) => setStep(e.target.value)} className={field} />
        </FieldBox>
        <FieldBox label="سقف تعداد monitored">
          <input type="number" dir="ltr" value={cap} onChange={(e) => setCap(e.target.value)} className={field} />
        </FieldBox>
      </div>

      <div className="mb-4">
        <SwitchRow label="فعال" hint="cron و routeها اجرا می‌شن" checked={isEnabled} onChange={setIsEnabled} />
      </div>

      <FieldBox label="یادداشت">
        <textarea dir="auto" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${field} leading-6`} />
      </FieldBox>

      <div className="mt-4 text-start">
        <Section icon="🔑" title="کلیدهای API (per-tenant)" summary="خالی بذار تا fallback به override کلی یا env" className="!mb-3">
          <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-3">
            خالی بذار تا fallback به override کلی یا env. مقدار قبلی نمایش داده نمی‌شه — فقط override کن.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input dir="ltr" type="password" value={hikerKey} onChange={(e) => setHikerKey(e.target.value)} placeholder="Hiker x-access-key" aria-label="Hiker x-access-key" autoComplete="off" className={`${field} font-mono`} />
            <input dir="ltr" type="text" value={hikerKeyName} onChange={(e) => setHikerKeyName(e.target.value)} placeholder="نام Hiker (smmr)" aria-label="نام Hiker" className={field} />
            <input dir="ltr" type="password" value={openrouterKey} onChange={(e) => setOpenrouterKey(e.target.value)} placeholder="OpenRouter sk-or-…" aria-label="OpenRouter key" autoComplete="off" className={`${field} font-mono sm:col-span-2`} />
            <input dir="ltr" type="password" value={groqKey} onChange={(e) => setGroqKey(e.target.value)} placeholder="Groq gsk_…" aria-label="Groq key" autoComplete="off" className={`${field} font-mono sm:col-span-2`} />
          </div>
        </Section>

        {tenant && (
          <Section icon="⚠️" title="عملیات خطرناک" summary="ریست خرج محلی، حذف کامل tenant" className="!mb-0">
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => resetSpend(tenant)} className={btnWarn}>
                🔁 ریست خرج محلی
              </button>
              <button onClick={() => deleteTenant(tenant)} className={btnDanger}>
                🗑 حذف tenant
              </button>
            </div>
          </Section>
        )}
      </div>
    </Sheet>
  );
}

function FinanceDialog(props: { finance: Finance; onClose: () => void }) {
  const { finance, onClose } = props;
  const maxHourly = Math.max(0.001, ...finance.hourly.map((b) => b.costUsd));
  const maxDaily = Math.max(0.001, ...finance.daily.map((b) => b.costUsd));
  const maxWeekly = Math.max(0.001, ...finance.weekly.map((b) => b.costUsd));
  const maxMonthly = Math.max(0.001, ...finance.monthly.map((b) => b.costUsd));

  return (
    <Sheet
      title={`📊 حساب‌کتاب — ${finance.tenant.name}`}
      wide
      onClose={onClose}
      footer={
        <div className="flex">
          <button onClick={onClose} className={btn}>
            بستن
          </button>
        </div>
      }
    >
      <div className="text-xs text-[var(--color-text-dim)] mb-3">
        plan: <strong>{finance.tenant.plan}</strong>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {(
          [
            ["خرج", usd(finance.state.spentUsd, 4)],
            ["مجاز تا", usd(finance.state.approvedUsd)],
            ["سقف", usd(finance.state.budgetUsd)],
            ["step", usd(finance.state.stepUsd)],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="rounded-xl border border-[var(--color-border)] py-2">
            <div className="text-xs text-[var(--color-text-dim)]">{label}</div>
            <div className="text-sm font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      {/* One row-card per window instead of a 4-column table, so nothing scrolls sideways on a phone. */}
      <div className="mb-4 flex flex-col gap-2">
        {(
          [
            ["⏰ ۱ ساعت", finance.summary.lastHour],
            ["📅 ۲۴ ساعت", finance.summary.today],
            ["🗓 ۷ روز", finance.summary.last7d],
            ["🗓 ۳۰ روز", finance.summary.last30d],
            ["Σ کل", finance.summary.allTime],
          ] as const
        ).map(([label, w]) => (
          <div key={label} className="rounded-xl border border-[var(--color-border)] px-3 py-2">
            <div className="text-sm font-medium mb-1">{label}</div>
            <div className="grid grid-cols-3 gap-2 tabular-nums">
              <div>
                <div className="text-xs text-[var(--color-text-dim)]">call</div>
                <div className="text-sm">{fa(w.calls.toLocaleString("en-US"))}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--color-text-dim)]">هزینه</div>
                <div className="text-sm font-semibold">{usd(w.costUsd, 4)}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--color-text-dim)]">میانگین / call</div>
                <div className="text-sm text-[var(--color-text-dim)]">{w.calls > 0 ? usd(w.costUsd / w.calls, 5) : "—"}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(
        [
          ["⏰ ساعتی (۲۴ ساعت)", finance.hourly, maxHourly, "bg-[var(--color-accent)]/70"],
          ["📅 روزانه (۱۴ روز)", finance.daily, maxDaily, "bg-[var(--color-accent)]/70"],
          ["🗓 هفتگی (۱۲ هفته)", finance.weekly, maxWeekly, "bg-emerald-600/70"],
          ["🗓 ماهانه (۶ ماه)", finance.monthly, maxMonthly, "bg-amber-500/70"],
        ] as const
      ).map(([label, buckets, max, color]) => (
        <div key={label} className="mb-4">
          <div className="text-sm font-medium mb-1.5">{label}</div>
          {buckets.length === 0 ? (
            <div className="text-xs text-[var(--color-text-dim)]">خالی</div>
          ) : (
            <div dir="ltr" className="flex items-end gap-0.5 h-16">
              {buckets.map((b) => (
                <div
                  key={b.at}
                  title={`${new Date(b.at).toLocaleString()} · ${b.calls} call · $${b.costUsd.toFixed(4)}`}
                  className={`flex-1 ${color} rounded-t-sm min-h-[2px]`}
                  style={{
                    height: `${Math.max(4, (b.costUsd / max) * 100)}%`,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="mb-2">
        <div className="text-sm font-medium mb-1.5">📜 آخرین callها</div>
        {finance.recent.length === 0 ? (
          <div className="text-xs text-[var(--color-text-dim)]">خالی</div>
        ) : (
          <div className="max-h-80 overflow-y-auto overscroll-contain flex flex-col gap-1.5">
            {finance.recent.map((c) => (
              <div key={c.id} className="rounded-xl border border-[var(--color-border)] px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-dim)]">
                  <span>{new Date(c.calledAt).toLocaleString()}</span>
                  <span className="tabular-nums">{usd(c.costUsd, 4)}</span>
                </div>
                <div dir="ltr" className="mt-0.5 truncate font-mono text-xs">
                  {c.endpoint}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

type ExternalStatusProp = {
  config: { enabled: boolean; baseUrl: string | null; secretConfigured: boolean };
  health: { ok: boolean; status: number; body: string; baseUrl: string | null };
  stats: {
    activeSubscriptions: number;
    totalSubscriptions: number;
    totalNotificationsReceived: number;
  };
  subscriptions: Array<{
    username: string;
    registeredAt: string;
    unregisteredAt: string | null;
    lastPushedAt: string | null;
    lastStatus: number | null;
    lastNotifiedAt: string | null;
    notifyCount: number;
  }>;
};

function ExternalMonitorPanel(props: {
  data: ExternalStatusProp | null;
  loading: boolean;
  syncing: boolean;
  syncResult: {
    total: number;
    succeeded: number;
    failed: number;
    errors: Array<{ username: string; status: number; body: string }>;
  } | null;
  onDismissSync: () => void;
  onReload: () => Promise<void>;
  onSync: () => Promise<void>;
}) {
  const { data, loading, syncing, syncResult, onDismissSync, onReload, onSync } =
    props;
  const code = "mx-1 px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] font-mono text-xs [overflow-wrap:anywhere]";
  return (
    <div className="flex flex-col gap-3">
      {syncResult && (
        <div
          className={`p-3 rounded-2xl border text-center ${
            syncResult.failed === 0
              ? "border-emerald-700 bg-emerald-900/20 text-emerald-200"
              : syncResult.succeeded > 0
                ? "border-amber-700 bg-amber-900/20 text-amber-200"
                : "border-red-700 bg-red-900/20 text-red-200"
          }`}
        >
          <div className="text-sm font-medium">
            {syncResult.failed === 0
              ? "✅ Sync کامل"
              : syncResult.succeeded > 0
                ? "⚠️ Sync جزئی"
                : "❌ Sync ناموفق"}
          </div>
          <div className="text-xs mt-0.5">
            {fa(syncResult.succeeded)} / {fa(syncResult.total)} موفق
            {syncResult.failed > 0 && ` · ${fa(syncResult.failed)} خطا`}
          </div>
          {syncResult.errors.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto flex flex-col gap-1 text-xs font-mono">
              {syncResult.errors.slice(0, 10).map((e) => (
                <div key={e.username} dir="ltr" className="break-all">
                  @{e.username} · {e.status || "—"} · {e.body.slice(0, 100)}
                </div>
              ))}
              {syncResult.errors.length > 10 && (
                <div className="text-[var(--color-text-dim)]">
                  … و {fa(syncResult.errors.length - 10)} مورد دیگه
                </div>
              )}
            </div>
          )}
          <button onClick={onDismissSync} className={`${btn} mt-2`}>
            بستن
          </button>
        </div>
      )}
      <Card>
        <div className="text-sm font-medium mb-3">🛰 تشخیص‌دهنده‌ی تغییر خارجی</div>
        {!data ? (
          <div className="text-sm text-[var(--color-text-dim)]">بارگذاری…</div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
              <div className="p-3 rounded-xl border border-[var(--color-border)]">
                <div className="text-xs text-[var(--color-text-dim)] mb-0.5">وضعیت</div>
                <div className="text-sm">
                  {data.config.enabled ? (
                    <span className="text-emerald-300">✅ فعال</span>
                  ) : (
                    <span className="text-amber-400">⏸ غیرفعال</span>
                  )}
                  {" · "}
                  {data.config.secretConfigured ? (
                    <span className="text-emerald-300">secret ✓</span>
                  ) : (
                    <span className="text-red-300">secret ✗</span>
                  )}
                </div>
                {data.config.baseUrl && (
                  <div dir="ltr" className="font-mono text-xs mt-0.5 break-all text-[var(--color-text-dim)]">
                    {data.config.baseUrl}
                  </div>
                )}
              </div>
              <div className="p-3 rounded-xl border border-[var(--color-border)]">
                <div className="text-xs text-[var(--color-text-dim)] mb-0.5">🩺 Health (آخرین بار)</div>
                <div className="text-sm">
                  {data.health.ok ? (
                    <span className="text-emerald-300">✅ {data.health.status}</span>
                  ) : (
                    <span className="text-red-300">✗ {data.health.status || "—"}</span>
                  )}
                </div>
                <div dir="ltr" className="text-xs text-[var(--color-text-dim)] mt-0.5 break-all font-mono">
                  {data.health.body.slice(0, 200)}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["فعال", data.stats.activeSubscriptions],
                  ["کل ثبت‌شده", data.stats.totalSubscriptions],
                  ["notify دریافتی", data.stats.totalNotificationsReceived],
                ] as const
              ).map(([label, n]) => (
                <div key={label} className="p-2 rounded-xl border border-[var(--color-border)]">
                  <div className="text-[var(--color-text-dim)] text-xs">{label}</div>
                  <div className="text-lg font-bold tabular-nums">{fa(n)}</div>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={onReload} disabled={loading} className={btn}>
            {loading ? "…" : "🔄 بارگذاری دوباره"}
          </button>
          <button
            onClick={onSync}
            disabled={syncing || !data?.config.enabled}
            className={btnOk}
            title="همه‌ی usernameهای فعال رو دوباره push کن"
          >
            {syncing ? "Sync…" : "🔁 Sync همه"}
          </button>
        </div>
      </Card>

      <Section
        icon="📋"
        title="اشتراک‌ها"
        summary={data ? `${fa(data.subscriptions.length)} اشتراک` : "در حال بارگذاری…"}
        defaultOpen
      >
        {!data || data.subscriptions.length === 0 ? (
          <EmptyState icon="📋" title="هنوز اشتراکی نیست" hint="وقتی owner یه اکانت اضافه می‌کنه اینجا میاد." />
        ) : (
          <div className="-mx-4 -mb-4">
            {data.subscriptions.map((s) => {
              const pushOk = s.lastStatus && s.lastStatus >= 200 && s.lastStatus < 300;
              return (
                <div
                  key={s.username}
                  className={`min-h-16 px-4 py-2.5 border-t first:border-t-0 border-[var(--color-border)] ${s.unregisteredAt ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <span className="text-sm font-medium [overflow-wrap:anywhere]" dir="ltr">
                      @{s.username}
                    </span>
                    {s.unregisteredAt ? (
                      <Badge tone="neutral">لغو‌شده</Badge>
                    ) : pushOk ? (
                      <Badge tone="success">{s.lastStatus}</Badge>
                    ) : s.lastStatus ? (
                      <Badge tone="danger">{s.lastStatus}</Badge>
                    ) : (
                      <Badge tone="info">در انتظار</Badge>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--color-text-dim)]">
                    notify‌شده ×{fa(s.notifyCount)}
                    {s.lastNotifiedAt && ` · آخرین notify: ${new Date(s.lastNotifiedAt).toLocaleString()}`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        icon="⚙️"
        title="پیکربندی اتصال"
        summary={data ? (data.config.enabled ? "فعال" : "غیرفعال") : "Base URL و secret"}
      >
        <ExternalConfigForm
          initial={{
            enabled: data?.config.enabled ?? false,
            baseUrl: data?.config.baseUrl ?? "",
            secretConfigured: data?.config.secretConfigured ?? false,
          }}
          onSaved={onReload}
        />
      </Section>

      <Section icon="📄" title="Docs برای سرویس خارجی" summary="contract، HMAC و endpointها">
        <p className="text-xs leading-7 text-[var(--color-text-dim)] mb-2">
          contract کامل (endpointها، HMAC، نمونه‌ی پایتون) توی repo:
          <code className={code} dir="ltr">
            docs/EXTERNAL_MONITOR_API.md
          </code>
        </p>
        <p className="text-xs text-[var(--color-text-dim)] mb-2">
          سرویس خارجی این چیزا رو باید بدونه:
        </p>
        <ul className="text-xs leading-8 text-[var(--color-text-dim)] list-none space-y-1">
          <li>
            URL ما برای notify:
            <code className={code} dir="ltr">
              POST /api/monitored/notify
            </code>
          </li>
          <li>
            Health endpoint ما (بدون auth):
            <code className={code} dir="ltr">
              GET /api/monitored/notify/health
            </code>
          </li>
          <li>
            Header امضا:
            <code className={code} dir="ltr">
              X-Signature: hex(HMAC_SHA256(body, secret))
            </code>
          </li>
          <li>سرویس خارجی باید endpointهای <code dir="ltr">POST /accounts</code>, <code dir="ltr">DELETE /accounts/&lt;username&gt;</code>, <code dir="ltr">GET /health</code> رو expose کنه.</li>
        </ul>
      </Section>
    </div>
  );
}

function ExternalConfigForm(props: {
  initial: { enabled: boolean; baseUrl: string; secretConfigured: boolean };
  onSaved: () => Promise<void>;
}) {
  const { initial, onSaved } = props;
  const [enabled, setEnabled] = useState(initial.enabled);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(initial.enabled);
    setBaseUrl(initial.baseUrl);
  }, [initial.enabled, initial.baseUrl]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const body: Record<string, string> = {
        monitorExternalEnabled: enabled ? "true" : "false",
        monitorExternalBaseUrl: baseUrl.trim().replace(/\/+$/, ""),
      };
      if (secret.trim()) body.monitorExternalSecret = secret.trim();
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setMsg(`❌ ${j.error ?? r.status}`);
        return;
      }
      setSecret("");
      setMsg("✅ ذخیره شد");
      setTimeout(() => setMsg(null), 4000);
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SwitchRow
        label="🔌 اتصال فعال"
        hint="خاموش شه ربات نه register می‌فرسته نه notify قبول می‌کنه"
        checked={enabled}
        onChange={setEnabled}
      />
      <FieldBox label="🌐 Base URL سرویس خارجی">
        <input
          dir="ltr"
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="http://144.126.199.205:8080"
          className={`${field} font-mono`}
        />
      </FieldBox>
      <FieldBox
        label={
          <>
            🔑 Shared HMAC secret
            <span className="block text-xs text-[var(--color-text-dim)]">
              {initial.secretConfigured
                ? "(در حال حاضر ست شده — برای rotate کن وارد کن)"
                : "(هنوز ست نشده)"}
            </span>
          </>
        }
      >
        <input
          dir="ltr"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="off"
          placeholder={initial.secretConfigured ? "********" : "hex 64 chars"}
          className={`${field} font-mono`}
        />
      </FieldBox>
      {msg && <p role="status" className="text-sm">{msg}</p>}
      <div>
        <button onClick={save} disabled={saving} className={btnPrimary}>
          {saving ? "ذخیره…" : "💾 ذخیره"}
        </button>
      </div>
    </div>
  );
}
