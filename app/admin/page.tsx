"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";

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

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
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
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [creating, setCreating] = useState(false);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulking, setBulking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setAccessDenied(false);
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
    if (op === "delete" && !confirm(`${selected.size} tenant حذف بشن؟`))
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
        alert(
          `${j.succeeded ?? 0} موفق · ${j.errors.length} خطا:\n` +
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
    const r = await fetch(`/api/admin/tenants/${tenantId}/finance`);
    if (r.ok) {
      const j = (await r.json()) as Finance;
      setFinance(j);
    } else {
      alert("خطا در بارگذاری");
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
          <p className="text-sm text-red-300">
            ⛔ دسترسی نداری. ADMIN_USER_IDS رو توی env ست کن یا از یکی از
            admin‌های فعلی بخواه اضافه‌ت کنه.
          </p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <PageTitle
        title="🛠 Admin"
        subtitle="مدیریت tenantها، حساب‌کتاب مالی، کلیدهای API، و assign کردن business_connectionها"
      />

      <div className="flex gap-1 mb-3 flex-wrap">
        {(
          [
            ["tenants", "🏢 Tenants", tenants.length],
            ["admins", "👮 Admins", admins.length],
            ["connections", "🔗 Connections", connections.length],
            ["external", "🛰 External monitor", external?.stats.activeSubscriptions ?? 0],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`text-xs px-3 py-1.5 rounded-md border ${
              tab === key
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15"
                : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      {tab === "tenants" && (
        <>
          <Card className="mb-3 !p-3">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <button
                onClick={() => setCreating(true)}
                className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white"
              >
                ➕ tenant جدید
              </button>
              <button
                onClick={() => setSelected(new Set(tenants.map((t) => t.id)))}
                className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              >
                انتخاب همه
              </button>
              <button
                onClick={() => setSelected(new Set())}
                disabled={selected.size === 0}
                className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
              >
                Clear
              </button>
              <span className="text-[var(--color-text-dim)]">
                {selected.size} انتخاب شده
              </span>
            </div>
            {selected.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap text-[11px] mt-2 pt-2 border-t border-[var(--color-border)]">
                <button
                  onClick={() => runBulk("enable")}
                  disabled={bulking}
                  className="px-2 py-1 rounded-md border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30"
                >
                  ▶ روشن
                </button>
                <button
                  onClick={() => runBulk("disable")}
                  disabled={bulking}
                  className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                >
                  ⏸ خاموش
                </button>
                <select
                  disabled={bulking}
                  defaultValue=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    runBulk("apply-plan", e.target.value);
                    e.currentTarget.value = "";
                  }}
                  className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-1.5 py-1"
                >
                  <option value="">📋 اعمال plan…</option>
                  {plans.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    if (!confirm(`خرج محلی ${selected.size} tenant ریست بشه؟`))
                      return;
                    runBulk("reset-spend");
                  }}
                  disabled={bulking}
                  className="px-2 py-1 rounded-md border border-amber-700 text-amber-300 hover:bg-amber-900/30"
                >
                  🔁 ریست خرج محلی
                </button>
                <button
                  onClick={() => runBulk("delete")}
                  disabled={bulking}
                  className="px-2 py-1 rounded-md border border-red-800 text-red-300 hover:bg-red-900/30"
                >
                  🗑 حذف
                </button>
              </div>
            )}
          </Card>

          <div className="flex flex-col gap-2">
            {tenants.map((t) => {
              const pct =
                t.hikerBudgetUsd > 0
                  ? Math.min(100, (t.spentUsd / t.hikerBudgetUsd) * 100)
                  : 0;
              const approvedPct =
                t.hikerBudgetUsd > 0
                  ? Math.min(100, (t.hikerApprovedUsd / t.hikerBudgetUsd) * 100)
                  : 0;
              return (
                <Card key={t.id} className={!t.isEnabled ? "opacity-50" : ""}>
                  <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggleSelect(t.id)}
                      />
                      <span className="text-base font-semibold">{t.name}</span>
                      <Badge tone={t.isEnabled ? "success" : "neutral"}>
                        {t.isEnabled ? "فعال" : "غیرفعال"}
                      </Badge>
                      <Badge tone="info">{t.plan}</Badge>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <button
                        onClick={() => openFinance(t.id)}
                        className="text-[11px] px-2 py-1 rounded-md border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30"
                        title="جزئیات مالی و چارت‌ها"
                      >
                        📊 جزئیات مالی
                      </button>
                      <a
                        href={`/settings?tenant=${t.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                        title="همه‌ی تنظیمات (مدل، owner، auto-reply، ...) per-tenant"
                      >
                        ⚙️ تنظیمات
                      </a>
                      <button
                        onClick={() => setEditing(t)}
                        className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                      >
                        ✏️ ویرایش
                      </button>
                    </div>
                  </div>

                  <div className="mb-2">
                    <div className="text-[10px] flex items-center justify-between text-[var(--color-text-dim)] mb-0.5">
                      <span>
                        خرج <strong>${t.spentUsd.toFixed(4)}</strong>{" "}
                        / مجاز ${t.hikerApprovedUsd.toFixed(2)} / سقف $
                        {t.hikerBudgetUsd.toFixed(2)} · step $
                        {t.hikerApprovalStepUsd.toFixed(2)}
                      </span>
                      <span>{pct.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-[var(--color-surface-2)] rounded-full overflow-hidden relative">
                      <div
                        className="absolute inset-y-0 left-0 bg-emerald-600/40"
                        style={{ width: `${approvedPct}%` }}
                      />
                      <div
                        className={`absolute inset-y-0 left-0 ${
                          pct >= 100
                            ? "bg-red-500"
                            : pct >= approvedPct
                              ? "bg-amber-500"
                              : "bg-[var(--color-accent)]"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <div className="text-[10px] text-[var(--color-text-dim)] flex flex-wrap gap-3">
                    <span>
                      monitored cap: <strong>{t.monitoredCap}</strong>
                    </span>
                    {t.hikerKeyPrefix ? (
                      <span dir="ltr">
                        Hiker: {t.hikerKeyName ? `[${t.hikerKeyName}] ` : ""}
                        <span className="font-mono">{t.hikerKeyPrefix}</span>
                      </span>
                    ) : (
                      <span className="text-amber-400">Hiker: (fallback)</span>
                    )}
                    {t.openrouterKeyPrefix ? (
                      <span dir="ltr">
                        OR:{" "}
                        <span className="font-mono">
                          {t.openrouterKeyPrefix}
                        </span>
                      </span>
                    ) : (
                      <span className="text-amber-400">OR: (fallback)</span>
                    )}
                    {t.groqKeyPrefix ? (
                      <span dir="ltr">
                        Groq:{" "}
                        <span className="font-mono">{t.groqKeyPrefix}</span>
                      </span>
                    ) : (
                      <span className="text-amber-400">Groq: (fallback)</span>
                    )}
                  </div>
                  {t.notes && (
                    <div className="text-[10px] mt-2 text-[var(--color-text-dim)]">
                      📝 {t.notes}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      {tab === "admins" && (
        <>
          <Card className="mb-3 !p-3">
            <AdminAddForm onSaved={load} />
          </Card>
          <Card>
            <div className="flex flex-col gap-1">
              {admins.map((a) => (
                <div
                  key={a.userId}
                  className="text-xs flex items-center gap-2 p-1.5 border border-[var(--color-border)] rounded-md flex-wrap"
                >
                  <span className="font-mono">{a.userId}</span>
                  {a.username && <span>@{a.username}</span>}
                  {a.firstName && (
                    <span className="text-[var(--color-text-dim)]">
                      {a.firstName}
                    </span>
                  )}
                  <span className="text-[10px] text-[var(--color-text-dim)] mr-auto">
                    {new Date(a.addedAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={async () => {
                      if (!confirm(`حذف admin ${a.userId}؟`)) return;
                      const r = await fetch(`/api/admin/admins/${a.userId}`, {
                        method: "DELETE",
                      });
                      if (!r.ok) {
                        const j = (await r.json().catch(() => ({}))) as {
                          error?: string;
                        };
                        alert(j.error ?? "خطا");
                      } else {
                        await load();
                      }
                    }}
                    className="text-[10px] px-1.5 py-0.5 rounded-md border border-red-700 text-red-300 hover:bg-red-900/30"
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {tab === "connections" && (
        <Card>
          <div className="flex flex-col gap-1">
            {connections.map((c) => (
              <div
                key={c.id}
                className="text-xs flex items-center gap-2 p-2 border border-[var(--color-border)] rounded-md flex-wrap"
              >
                <span className="font-medium">
                  {[c.firstName, c.lastName].filter(Boolean).join(" ") ||
                    c.username ||
                    `user ${c.userId}`}
                </span>
                {c.username && (
                  <span className="text-[var(--color-text-dim)]">
                    @{c.username}
                  </span>
                )}
                <span className="text-[10px] text-[var(--color-text-dim)]">
                  uid {c.userId}
                </span>
                {!c.isEnabled && <Badge tone="neutral">disabled</Badge>}
                {c.canReply && <Badge tone="success">can reply</Badge>}
                <div className="flex-1" />
                <select
                  value={c.tenantId ?? ""}
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
                    if (!r.ok) alert("خطا");
                    else await load();
                  }}
                  className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-0.5 text-[11px]"
                >
                  <option value="">— انتخاب tenant —</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </Card>
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
          onSync={async () => {
            setSyncing(true);
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
              alert(
                `Sync: ${j.succeeded ?? 0} / ${j.total ?? 0} موفق · ${j.failed ?? 0} خطا` +
                  (j.errors && j.errors.length > 0
                    ? `\n\n${j.errors.slice(0, 5).map((e) => `${e.username}: ${e.status} ${e.body.slice(0, 60)}`).join("\n")}`
                    : ""),
              );
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
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        dir="ltr"
        type="text"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        placeholder="Telegram user_id (عدد)"
        className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 text-xs w-44"
      />
      <input
        dir="ltr"
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="username (اختیاری)"
        className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 text-xs w-40"
      />
      <button
        onClick={async () => {
          setBusy(true);
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
              alert(j.error ?? "خطا");
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
        className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
      >
        ➕ افزودن admin
      </button>
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
        alert(j.error ?? "خطا");
        return;
      }
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 w-full max-w-2xl my-8"
      >
        <h2 className="text-base font-semibold mb-3">
          {tenant ? `✏️ ویرایش ${tenant.name}` : "➕ tenant جدید"}
        </h2>

        <div className="mb-3">
          <div className="text-xs font-medium mb-1">📋 Plan preset</div>
          <div className="flex gap-1.5 flex-wrap text-[11px]">
            {plans.map((p) => (
              <button
                key={p.key}
                onClick={() => applyPreset(p.key)}
                className={`px-2 py-1 rounded-md border ${
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
          <div className="text-[9px] text-[var(--color-text-dim)] mt-1">
            preset مقادیر سقف + step + cap رو ست می‌کنه — می‌تونی دستی هم
            override کنی
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--color-text-dim)]">نام</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--color-text-dim)]">plan</span>
            <input
              type="text"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--color-text-dim)]">
              سقف بودجه ($)
            </span>
            <input
              type="number"
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--color-text-dim)]">
              مجاز فعلی ($)
            </span>
            <input
              type="number"
              step="0.01"
              value={approved}
              onChange={(e) => setApproved(e.target.value)}
              className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--color-text-dim)]">
              step تخصیص ($)
            </span>
            <input
              type="number"
              step="0.01"
              value={step}
              onChange={(e) => setStep(e.target.value)}
              className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--color-text-dim)]">
              سقف تعداد monitored
            </span>
            <input
              type="number"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 mb-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => setIsEnabled(e.target.checked)}
          />
          <span>فعال (cron و routeها اجرا می‌شن)</span>
        </label>

        <div className="mb-3">
          <div className="text-xs font-medium mb-1">🔑 کلیدهای API (per-tenant)</div>
          <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
            خالی بذار تا fallback به override کلی یا env. مقدار قبلی نمایش
            داده نمی‌شه — فقط override کن.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <input
              dir="ltr"
              type="password"
              value={hikerKey}
              onChange={(e) => setHikerKey(e.target.value)}
              placeholder="Hiker x-access-key"
              className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 font-mono"
            />
            <input
              dir="ltr"
              type="text"
              value={hikerKeyName}
              onChange={(e) => setHikerKeyName(e.target.value)}
              placeholder="نام Hiker (smmr)"
              className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
            />
            <input
              dir="ltr"
              type="password"
              value={openrouterKey}
              onChange={(e) => setOpenrouterKey(e.target.value)}
              placeholder="OpenRouter sk-or-…"
              className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 font-mono sm:col-span-2"
            />
            <input
              dir="ltr"
              type="password"
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              placeholder="Groq gsk_…"
              className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 font-mono sm:col-span-2"
            />
          </div>
        </div>

        <label className="flex flex-col gap-1 mb-4 text-sm">
          <span className="text-[11px] text-[var(--color-text-dim)]">یادداشت</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
          />
        </label>

        {tenant && (
          <div className="mb-4 p-2 rounded-md border border-amber-700 bg-amber-900/15">
            <div className="text-[11px] text-amber-200 mb-1">عملیات خطرناک</div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={async () => {
                  if (!confirm("کل خرج محلی این tenant ریست بشه؟")) return;
                  const r = await fetch(
                    `/api/admin/tenants/${tenant.id}/reset-spend`,
                    { method: "POST" },
                  );
                  if (r.ok) {
                    await onSaved();
                  } else alert("خطا");
                }}
                className="text-[11px] px-2 py-1 rounded-md border border-amber-700 text-amber-300 hover:bg-amber-900/30"
              >
                🔁 ریست خرج محلی
              </button>
              <button
                onClick={async () => {
                  if (
                    !confirm(
                      `حذف کامل ${tenant.name}؟ همه‌ی monitored / usage پاک می‌شه.`,
                    )
                  )
                    return;
                  const r = await fetch(`/api/admin/tenants/${tenant.id}`, {
                    method: "DELETE",
                  });
                  if (r.ok) {
                    await onSaved();
                  } else {
                    const j = (await r.json().catch(() => ({}))) as {
                      error?: string;
                    };
                    alert(j.error ?? "خطا");
                  }
                }}
                className="text-[11px] px-2 py-1 rounded-md border border-red-700 text-red-300 hover:bg-red-900/30"
              >
                🗑 حذف tenant
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
          >
            لغو
          </button>
          <button
            onClick={save}
            disabled={busy || !name.trim()}
            className="text-xs px-4 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
          >
            {busy ? "ذخیره…" : "💾 ذخیره"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FinanceDialog(props: { finance: Finance; onClose: () => void }) {
  const { finance, onClose } = props;
  const maxHourly = Math.max(0.001, ...finance.hourly.map((b) => b.costUsd));
  const maxDaily = Math.max(0.001, ...finance.daily.map((b) => b.costUsd));
  const maxWeekly = Math.max(0.001, ...finance.weekly.map((b) => b.costUsd));
  const maxMonthly = Math.max(0.001, ...finance.monthly.map((b) => b.costUsd));

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 w-full max-w-3xl my-8"
      >
        <h2 className="text-base font-semibold mb-1">
          📊 حساب‌کتاب — {finance.tenant.name}
        </h2>
        <div className="text-[11px] text-[var(--color-text-dim)] mb-3">
          plan: <strong>{finance.tenant.plan}</strong>
        </div>

        <div className="flex items-center gap-3 flex-wrap text-[11px] mb-3 p-2 rounded-md border border-[var(--color-border)]">
          <span>
            خرج: <strong>${finance.state.spentUsd.toFixed(4)}</strong>
          </span>
          <span>
            مجاز تا: <strong>${finance.state.approvedUsd.toFixed(2)}</strong>
          </span>
          <span>
            سقف: <strong>${finance.state.budgetUsd.toFixed(2)}</strong>
          </span>
          <span>
            step: <strong>${finance.state.stepUsd.toFixed(2)}</strong>
          </span>
        </div>

        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="text-[var(--color-text-dim)]">
              <tr className="text-right">
                <th className="font-normal py-1">بازه</th>
                <th className="font-normal py-1">تعداد call</th>
                <th className="font-normal py-1">هزینه</th>
                <th className="font-normal py-1">میانگین / call</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["⏰ ۱ ساعت", finance.summary.lastHour],
                  ["📅 ۲۴ ساعت", finance.summary.today],
                  ["🗓 ۷ روز", finance.summary.last7d],
                  ["🗓 ۳۰ روز", finance.summary.last30d],
                  ["Σ کل", finance.summary.allTime],
                ] as const
              ).map(([label, w]) => (
                <tr
                  key={label}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="py-1">{label}</td>
                  <td className="py-1">{w.calls.toLocaleString()}</td>
                  <td className="py-1 font-semibold">
                    ${w.costUsd.toFixed(4)}
                  </td>
                  <td className="py-1 text-[var(--color-text-dim)]">
                    {w.calls > 0
                      ? `$${(w.costUsd / w.calls).toFixed(5)}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(
          [
            ["⏰ ساعتی (۲۴ ساعت)", finance.hourly, maxHourly, "bg-[var(--color-accent)]/70"],
            ["📅 روزانه (۱۴ روز)", finance.daily, maxDaily, "bg-[var(--color-accent)]/70"],
            ["🗓 هفتگی (۱۲ هفته)", finance.weekly, maxWeekly, "bg-emerald-600/70"],
            ["🗓 ماهانه (۶ ماه)", finance.monthly, maxMonthly, "bg-amber-500/70"],
          ] as const
        ).map(([label, buckets, max, color]) => (
          <div key={label} className="mb-3">
            <div className="text-xs font-medium mb-1">{label}</div>
            {buckets.length === 0 ? (
              <div className="text-[11px] text-[var(--color-text-dim)]">
                خالی
              </div>
            ) : (
              <div className="flex items-end gap-0.5 h-12">
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
          <div className="text-xs font-medium mb-1">📜 آخرین callها</div>
          {finance.recent.length === 0 ? (
            <div className="text-[11px] text-[var(--color-text-dim)]">خالی</div>
          ) : (
            <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5">
              {finance.recent.map((c) => (
                <div
                  key={c.id}
                  className="text-[10px] flex items-center gap-2 py-0.5 border-b border-[var(--color-border)]"
                >
                  <span className="text-[var(--color-text-dim)] w-28 shrink-0">
                    {new Date(c.calledAt).toLocaleString()}
                  </span>
                  <span dir="ltr" className="flex-1 truncate font-mono">
                    {c.endpoint}
                  </span>
                  <span className="text-[var(--color-text-dim)]">
                    ${c.costUsd.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
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
  onReload: () => Promise<void>;
  onSync: () => Promise<void>;
}) {
  const { data, loading, syncing, onReload, onSync } = props;
  return (
    <div className="flex flex-col gap-3">
      <Card className="!p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <div className="text-sm font-medium">🛰 External change detector</div>
          <div className="flex gap-2">
            <a
              href="/settings#monitorExternal"
              className="text-[10px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
            >
              ⚙️ تنظیمات (settings)
            </a>
            <button
              onClick={onReload}
              disabled={loading}
              className="text-[10px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              {loading ? "…" : "🔄"}
            </button>
            <button
              onClick={onSync}
              disabled={syncing || !data?.config.enabled}
              className="text-[10px] px-2 py-1 rounded-md border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-50"
              title="همه‌ی usernameهای فعال رو دوباره push کن"
            >
              {syncing ? "Sync…" : "🔁 Sync all"}
            </button>
          </div>
        </div>
        {!data ? (
          <div className="text-[11px] text-[var(--color-text-dim)]">
            بارگذاری…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] mb-2">
              <div className="p-2 rounded-md border border-[var(--color-border)]">
                <div className="text-[var(--color-text-dim)] mb-0.5">وضعیت</div>
                <div>
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
                  <div dir="ltr" className="font-mono text-[10px] mt-0.5 break-all text-[var(--color-text-dim)]">
                    {data.config.baseUrl}
                  </div>
                )}
              </div>
              <div className="p-2 rounded-md border border-[var(--color-border)]">
                <div className="text-[var(--color-text-dim)] mb-0.5">
                  🩺 Health (آخرین بار)
                </div>
                <div>
                  {data.health.ok ? (
                    <span className="text-emerald-300">
                      ✅ {data.health.status}
                    </span>
                  ) : (
                    <span className="text-red-300">
                      ✗ {data.health.status || "—"}
                    </span>
                  )}
                </div>
                <div className="text-[9px] text-[var(--color-text-dim)] mt-0.5 break-all font-mono">
                  {data.health.body.slice(0, 200)}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div className="p-2 rounded-md border border-[var(--color-border)] text-center">
                <div className="text-[var(--color-text-dim)] text-[10px]">
                  فعال
                </div>
                <div className="text-base font-bold tabular-nums">
                  {data.stats.activeSubscriptions}
                </div>
              </div>
              <div className="p-2 rounded-md border border-[var(--color-border)] text-center">
                <div className="text-[var(--color-text-dim)] text-[10px]">
                  کل ثبت‌شده
                </div>
                <div className="text-base font-bold tabular-nums">
                  {data.stats.totalSubscriptions}
                </div>
              </div>
              <div className="p-2 rounded-md border border-[var(--color-border)] text-center">
                <div className="text-[var(--color-text-dim)] text-[10px]">
                  notify دریافتی
                </div>
                <div className="text-base font-bold tabular-nums">
                  {data.stats.totalNotificationsReceived}
                </div>
              </div>
            </div>
          </>
        )}
      </Card>

      <Card className="!p-3">
        <div className="text-xs font-medium mb-2">📋 Subscriptions</div>
        {!data || data.subscriptions.length === 0 ? (
          <div className="text-[11px] text-[var(--color-text-dim)]">
            خالی. وقتی owner یه اکانت اضافه می‌کنه اینجا میاد.
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {data.subscriptions.map((s) => {
              const pushOk = s.lastStatus && s.lastStatus >= 200 && s.lastStatus < 300;
              return (
                <div
                  key={s.username}
                  className={`text-[11px] flex items-center gap-2 p-1.5 rounded-md border ${
                    s.unregisteredAt
                      ? "border-[var(--color-border)] opacity-50"
                      : "border-[var(--color-border)]"
                  } flex-wrap`}
                >
                  <span className="font-medium" dir="ltr">
                    @{s.username}
                  </span>
                  {s.unregisteredAt ? (
                    <Badge tone="neutral">unregistered</Badge>
                  ) : pushOk ? (
                    <Badge tone="success">{s.lastStatus}</Badge>
                  ) : s.lastStatus ? (
                    <Badge tone="danger">{s.lastStatus}</Badge>
                  ) : (
                    <Badge tone="info">pending</Badge>
                  )}
                  <span className="text-[10px] text-[var(--color-text-dim)]">
                    notified ×{s.notifyCount}
                  </span>
                  <div className="flex-1" />
                  {s.lastNotifiedAt && (
                    <span className="text-[9px] text-[var(--color-text-dim)]">
                      آخرین notify: {new Date(s.lastNotifiedAt).toLocaleString()}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="!p-3">
        <div className="text-xs font-medium mb-1">📄 Docs برای سرویس خارجی</div>
        <p className="text-[11px] text-[var(--color-text-dim)] mb-2">
          contract کامل (endpointها، HMAC، نمونه‌ی پایتون) توی repo:
          <code className="mx-1 px-1 rounded bg-[var(--color-surface-2)] font-mono text-[10px]" dir="ltr">
            docs/EXTERNAL_MONITOR_API.md
          </code>
        </p>
        <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
          سرویس خارجی این چیزا رو باید بدونه:
        </p>
        <ul className="text-[10px] text-[var(--color-text-dim)] list-disc list-inside space-y-0.5">
          <li>
            URL ما برای notify:
            <code className="mx-1 px-1 rounded bg-[var(--color-surface-2)] font-mono" dir="ltr">
              POST /api/monitored/notify
            </code>
          </li>
          <li>
            Health endpoint ما (بدون auth):
            <code className="mx-1 px-1 rounded bg-[var(--color-surface-2)] font-mono" dir="ltr">
              GET /api/monitored/notify/health
            </code>
          </li>
          <li>
            Header امضا:
            <code className="mx-1 px-1 rounded bg-[var(--color-surface-2)] font-mono" dir="ltr">
              X-Signature: hex(HMAC_SHA256(body, secret))
            </code>
          </li>
          <li>سرویس خارجی باید endpointهای <code dir="ltr">POST /accounts</code>, <code dir="ltr">DELETE /accounts/&lt;username&gt;</code>, <code dir="ltr">GET /health</code> رو expose کنه.</li>
        </ul>
      </Card>
    </div>
  );
}
