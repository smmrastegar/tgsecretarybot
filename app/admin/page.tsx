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

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [tab, setTab] = useState<"tenants" | "admins" | "connections">(
    "tenants",
  );
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [creating, setCreating] = useState(false);

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
      const [t, a, c] = await Promise.all([
        fetch("/api/admin/tenants"),
        fetch("/api/admin/admins"),
        fetch("/api/admin/connections"),
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
        subtitle="مدیریت tenantها، admin‌ها، و assign کردن business_connectionها"
      />

      <div className="flex gap-1 mb-3 flex-wrap">
        {(
          [
            ["tenants", "🏢 Tenants", tenants.length],
            ["admins", "👮 Admins", admins.length],
            ["connections", "🔗 Connections", connections.length],
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
            <button
              onClick={() => setCreating(true)}
              className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white"
            >
              ➕ tenant جدید
            </button>
          </Card>

          <div className="flex flex-col gap-2">
            {tenants.map((t) => (
              <Card
                key={t.id}
                className={!t.isEnabled ? "opacity-50" : ""}
              >
                <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-semibold">{t.name}</span>
                    <Badge tone={t.isEnabled ? "success" : "neutral"}>
                      {t.isEnabled ? "فعال" : "غیرفعال"}
                    </Badge>
                    <Badge tone="info">{t.plan}</Badge>
                  </div>
                  <button
                    onClick={() => setEditing(t)}
                    className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                  >
                    ⚙️ ویرایش
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] mb-2">
                  <div className="p-1.5 rounded-md border border-[var(--color-border)]">
                    <div className="text-[var(--color-text-dim)]">خرج</div>
                    <div className="font-semibold tabular-nums">
                      ${t.spentUsd.toFixed(4)}
                    </div>
                  </div>
                  <div className="p-1.5 rounded-md border border-[var(--color-border)]">
                    <div className="text-[var(--color-text-dim)]">مجاز</div>
                    <div className="font-semibold tabular-nums">
                      ${t.hikerApprovedUsd.toFixed(2)}
                    </div>
                  </div>
                  <div className="p-1.5 rounded-md border border-[var(--color-border)]">
                    <div className="text-[var(--color-text-dim)]">سقف</div>
                    <div className="font-semibold tabular-nums">
                      ${t.hikerBudgetUsd.toFixed(2)}
                    </div>
                  </div>
                  <div className="p-1.5 rounded-md border border-[var(--color-border)]">
                    <div className="text-[var(--color-text-dim)]">step</div>
                    <div className="font-semibold tabular-nums">
                      ${t.hikerApprovalStepUsd.toFixed(2)}
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-[var(--color-text-dim)] flex flex-wrap gap-3">
                  <span>
                    monitored cap: <strong>{t.monitoredCap}</strong>
                  </span>
                  {t.hikerKeyPrefix && (
                    <span dir="ltr">
                      Hiker: {t.hikerKeyName ? `[${t.hikerKeyName}] ` : ""}
                      <span className="font-mono">{t.hikerKeyPrefix}</span>
                    </span>
                  )}
                  {!t.hikerKeyPrefix && (
                    <span className="text-amber-400">Hiker: (fallback)</span>
                  )}
                  {t.openrouterKeyPrefix && (
                    <span dir="ltr">
                      OR: <span className="font-mono">{t.openrouterKeyPrefix}</span>
                    </span>
                  )}
                </div>
                {t.notes && (
                  <div className="text-[10px] mt-2 text-[var(--color-text-dim)]">
                    📝 {t.notes}
                  </div>
                )}
              </Card>
            ))}
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

      {creating && (
        <TenantEditDialog
          tenant={null}
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
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
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
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { tenant, onClose, onSaved } = props;
  const [name, setName] = useState(tenant?.name ?? "");
  const [plan, setPlan] = useState(tenant?.plan ?? "starter");
  const [budget, setBudget] = useState(String(tenant?.hikerBudgetUsd ?? 50));
  const [approved, setApproved] = useState(
    String(tenant?.hikerApprovedUsd ?? 10),
  );
  const [step, setStep] = useState(
    String(tenant?.hikerApprovalStepUsd ?? 2),
  );
  const [cap, setCap] = useState(String(tenant?.monitoredCap ?? 50));
  const [isEnabled, setIsEnabled] = useState(tenant?.isEnabled ?? true);
  const [notes, setNotes] = useState(tenant?.notes ?? "");
  const [hikerKey, setHikerKey] = useState("");
  const [hikerKeyName, setHikerKeyName] = useState(tenant?.hikerKeyName ?? "");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [busy, setBusy] = useState(false);

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
          {tenant ? `⚙️ ویرایش ${tenant.name}` : "➕ tenant جدید"}
        </h2>

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
          <div className="text-xs font-medium mb-1">
            🔑 کلیدها (per-tenant)
          </div>
          <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
            خالی بذار تا fallback به override کلی یا env. مقدار قبلی نمایش
            داده نمی‌شه — فقط می‌تونی override کنی.
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
