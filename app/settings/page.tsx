"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";

type Settings = {
  ownerName: string;
  ownerContext: string;
  importanceThreshold: string;
  ownerNotifyChatId: string;
  alertWebhookUrl: string;
  alertWebhookMethod: string;
  alertWebhookHeaders: string;
  autoReplyEnabled: string;
  autoReplyText: string;
  autoReplyCooldownMinutes: string;
  groupAnalysisEnabled: string;
  groupSummaryHourUTC: string;
};

type FieldConfig = {
  key: keyof Settings;
  label: string;
  hint?: string;
  type?: "text" | "textarea" | "number" | "toggle";
};

const SECTIONS: Array<{ title: string; fields: FieldConfig[] }> = [
  {
    title: "Owner profile",
    fields: [
      {
        key: "ownerName",
        label: "Your name",
        hint: "How people address you in chats. Helps the classifier identify messages directed at you.",
      },
      {
        key: "ownerContext",
        label: "Personal context",
        hint: "One or two sentences about you (role, family, common topics).",
        type: "textarea",
      },
    ],
  },
  {
    title: "Urgent detection",
    fields: [
      {
        key: "importanceThreshold",
        label: "Importance threshold (0-10)",
        hint: "Below this, alerts are suppressed even if marked urgent.",
        type: "number",
      },
      {
        key: "ownerNotifyChatId",
        label: "Telegram chat id for urgent heads-up",
        hint: "Usually your own user id. Receives a copy of every alert via this bot.",
      },
    ],
  },
  {
    title: "Alert device webhook",
    fields: [
      {
        key: "alertWebhookUrl",
        label: "Alert webhook URL",
        hint: "POSTed with the urgent message payload. Empty disables.",
      },
      {
        key: "alertWebhookMethod",
        label: "HTTP method",
      },
      {
        key: "alertWebhookHeaders",
        label: "Extra headers (JSON object)",
        type: "textarea",
      },
    ],
  },
  {
    title: "Auto-reply (urgent DMs only)",
    fields: [
      { key: "autoReplyEnabled", label: "Enabled", type: "toggle" },
      { key: "autoReplyText", label: "Default text", type: "textarea" },
      {
        key: "autoReplyCooldownMinutes",
        label: "Cooldown per sender (minutes)",
        hint: "Won't auto-reply to the same chat more than once per this window.",
        type: "number",
      },
    ],
  },
  {
    title: "Group analyzer",
    fields: [
      { key: "groupAnalysisEnabled", label: "Enabled", type: "toggle" },
      {
        key: "groupSummaryHourUTC",
        label: "Daily summary hour (UTC)",
        hint: "Vercel Cron is configured separately in vercel.json.",
        type: "number",
      },
    ],
  },
];

export default function SettingsPage() {
  const [values, setValues] = useState<Settings | null>(null);
  const [envLocked, setEnvLocked] = useState<Set<keyof Settings>>(new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/settings");
    if (!r.ok) return;
    const j = (await r.json()) as {
      values: Settings;
      envLocked: Array<keyof Settings>;
    };
    setValues(j.values);
    setEnvLocked(new Set(j.envLocked));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function update<K extends keyof Settings>(key: K, val: string) {
    setValues((v) => (v ? { ...v, [key]: val } : v));
  }

  async function save() {
    if (!values) return;
    setSaving(true);
    setMsg(null);
    const payload: Partial<Settings> = {};
    for (const k of Object.keys(values) as Array<keyof Settings>) {
      if (!envLocked.has(k)) payload[k] = values[k];
    }
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `save failed (${r.status})`);
      }
      setMsg("Saved.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!values) {
    return (
      <Shell>
        <PageTitle title="Settings" />
        <Card>Loading…</Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <PageTitle
        title="Settings"
        subtitle="Everything tunable. Values locked by environment variables are read-only."
        actions={
          <button
            disabled={saving}
            onClick={save}
            className="text-xs px-4 py-2 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        }
      />

      {msg && (
        <Card className="mb-6">
          <p className="text-sm">{msg}</p>
        </Card>
      )}

      <div className="flex flex-col gap-4 md:gap-6">
        {SECTIONS.map((section) => (
          <Card key={section.title}>
            <h2 className="text-sm font-semibold mb-1">{section.title}</h2>
            <div className="mt-4 flex flex-col gap-4">
              {section.fields.map((f) => {
                const locked = envLocked.has(f.key);
                const val = values[f.key];
                const lockedSuffix = locked ? " (locked by env)" : "";
                if (f.type === "toggle") {
                  return (
                    <label
                      key={f.key}
                      className="flex items-center gap-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={val.toLowerCase() !== "false" && val !== ""}
                        onChange={(e) =>
                          update(f.key, e.target.checked ? "true" : "false")
                        }
                      />
                      <span>
                        {f.label}
                        <span className="text-[var(--color-text-dim)] text-xs">
                          {lockedSuffix}
                        </span>
                      </span>
                    </label>
                  );
                }
                return (
                  <div key={f.key}>
                    <label className="block text-xs text-[var(--color-text-dim)] mb-1">
                      {f.label}
                      {lockedSuffix && (
                        <span className="ml-1 italic">{lockedSuffix}</span>
                      )}
                    </label>
                    {f.type === "textarea" ? (
                      <textarea
                        rows={3}
                        disabled={locked}
                        value={val}
                        onChange={(e) => update(f.key, e.target.value)}
                        className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm disabled:opacity-60"
                      />
                    ) : (
                      <input
                        type={f.type === "number" ? "number" : "text"}
                        disabled={locked}
                        value={val}
                        onChange={(e) => update(f.key, e.target.value)}
                        className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm disabled:opacity-60"
                      />
                    )}
                    {f.hint && (
                      <p className="text-xs text-[var(--color-text-dim)] mt-1">
                        {f.hint}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </Shell>
  );
}
