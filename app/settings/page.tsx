"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";

type Settings = {
  ownerName: string;
  ownerDisplayName: string;
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
  dmActiveGraceMinutes: string;
  groupActiveGraceMinutes: string;
  secretaryEnabled: string;
  secretaryUserId: string;
  secretaryDisplayName: string;
  secretarySessionMinutes: string;
  secretarySuppressAutoReply: string;
  secretaryAutoTranscribe: string;
  secretariesJson: string;
  aiModelsCsv: string;
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
        key: "ownerDisplayName",
        label: "Display name used in replies",
        hint: "The name you sign as in conversations (used by AI / friendly auto-reply when signing). Defaults to Your name.",
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
    title: "Active-conversation grace",
    fields: [
      {
        key: "dmActiveGraceMinutes",
        label: "DM grace (minutes)",
        hint: "If YOU sent any message in a DM within this window, incoming messages there are logged but NOT classified, alerted, or auto-replied. 0 disables. VIP chats bypass this.",
        type: "number",
      },
      {
        key: "groupActiveGraceMinutes",
        label: "Group grace (minutes)",
        hint: "Same idea for group chats. Defaults higher because group activity is bursty.",
        type: "number",
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
  {
    title: "Human secretary relay",
    fields: [
      {
        key: "secretaryEnabled",
        label: "Enabled",
        type: "toggle",
      },
      {
        key: "secretaryUserId",
        label: "Secretary Telegram user id",
        hint: "Numeric Telegram id of the human who will handle urgent DMs. They MUST send /start to this bot once so the bot can DM them.",
      },
      {
        key: "secretaryDisplayName",
        label: "Display name (optional)",
        hint: "Just for labels in the dashboard.",
      },
      {
        key: "secretarySessionMinutes",
        label: "Session idle timeout (minutes)",
        hint: "After this much inactivity, the thread auto-closes and the next urgent message starts a fresh session.",
        type: "number",
      },
      {
        key: "secretarySuppressAutoReply",
        label: "Suppress auto-reply when secretary is handling",
        type: "toggle",
      },
      {
        key: "secretaryAutoTranscribe",
        label: "Auto-transcribe voice / audio / video notes for the secretary",
        hint: "When a voice or audio message is forwarded, the bot also sends the Groq / Gemini transcript as a reply in the same thread.",
        type: "toggle",
      },
    ],
  },
];

const KNOWN_MODELS: Array<{ id: string; in: number; out: number; label: string }> = [
  { id: "google/gemini-2.0-flash-lite-001", in: 0.075, out: 0.3, label: "Gemini 2.0 Flash Lite" },
  { id: "google/gemini-2.0-flash-001", in: 0.1, out: 0.4, label: "Gemini 2.0 Flash" },
  { id: "google/gemini-2.5-flash", in: 0.3, out: 2.5, label: "Gemini 2.5 Flash" },
  { id: "anthropic/claude-haiku-4-5", in: 1.0, out: 5.0, label: "Claude Haiku 4.5" },
  { id: "anthropic/claude-sonnet-4-6", in: 3.0, out: 15.0, label: "Claude Sonnet 4.6" },
  { id: "openai/gpt-4o-mini", in: 0.15, out: 0.6, label: "GPT-4o mini" },
];

type Secretary = { userId: number; name: string };

function parseSecretaries(json: string): Secretary[] {
  try {
    const arr = JSON.parse(json || "[]") as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((s) => {
        const o = s as { userId?: unknown; name?: unknown };
        const id = Number(o.userId);
        if (!Number.isFinite(id) || id <= 0) return null;
        return { userId: id, name: typeof o.name === "string" ? o.name : `user ${id}` };
      })
      .filter((x): x is Secretary => x !== null);
  } catch {
    return [];
  }
}

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

  // Approx OpenRouter input price ($/1M tokens) for the cost-sort button.
  const MODEL_RATES_IN: Record<string, number> = {
    "google/gemini-2.0-flash-lite-001": 0.075,
    "google/gemini-2.0-flash-001": 0.1,
    "google/gemini-2.5-flash": 0.3,
    "anthropic/claude-haiku-4-5": 1.0,
    "anthropic/claude-sonnet-4-6": 3.0,
    "openai/gpt-4o-mini": 0.15,
  };
  function sortModelsCheapestFirst() {
    if (!values) return;
    const list = (values.aiModelsCsv || "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    if (list.length === 0) {
      const ranked = Object.entries(MODEL_RATES_IN)
        .sort((a, b) => a[1] - b[1])
        .map(([m]) => m);
      update("aiModelsCsv", ranked.join(", "));
      return;
    }
    list.sort(
      (a, b) =>
        (MODEL_RATES_IN[a] ?? Infinity) - (MODEL_RATES_IN[b] ?? Infinity),
    );
    update("aiModelsCsv", list.join(", "));
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
        {/* Custom rich editor: Secretaries */}
        <Card>
          <h2 className="text-sm font-semibold mb-1">Secretaries</h2>
          <p className="text-xs text-[var(--color-text-dim)] mb-4">
            The first one in the list handles automatic forwards. Add or
            remove anyone with a numeric Telegram user id (they must /start
            the bot once so it can DM them).
            {envLocked.has("secretariesJson") && (
              <span className="ml-2 italic">(locked by env)</span>
            )}
          </p>
          <SecretariesEditor
            value={parseSecretaries(values.secretariesJson)}
            disabled={envLocked.has("secretariesJson")}
            onChange={(list) =>
              update("secretariesJson", JSON.stringify(list))
            }
          />
        </Card>

        {/* Custom rich editor: AI Models */}
        <Card>
          <h2 className="text-sm font-semibold mb-1">AI model priority</h2>
          <p className="text-xs text-[var(--color-text-dim)] mb-4">
            The first model is tried for each call; on failure the bot falls
            back to the next. Costs shown are OpenRouter input/output prices
            per million tokens.
            {envLocked.has("aiModelsCsv") && (
              <span className="ml-2 italic">(locked by env)</span>
            )}
          </p>
          <ModelsEditor
            value={(values.aiModelsCsv || "")
              .split(",")
              .map((m) => m.trim())
              .filter(Boolean)}
            disabled={envLocked.has("aiModelsCsv")}
            onChange={(list) => update("aiModelsCsv", list.join(", "))}
          />
        </Card>

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
                    {f.key === "aiModelsCsv" && (
                      <button
                        type="button"
                        onClick={sortModelsCheapestFirst}
                        disabled={locked}
                        className="mt-2 text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                      >
                        💵 Sort cheapest first
                      </button>
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

function SecretariesEditor({
  value,
  onChange,
  disabled,
}: {
  value: Secretary[];
  onChange: (list: Secretary[]) => void;
  disabled: boolean;
}) {
  function update(idx: number, patch: Partial<Secretary>) {
    const next = value.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange(next);
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...value, { userId: 0, name: "" }]);
  }
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    onChange(next);
  }
  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="text-xs text-[var(--color-text-dim)]">
          No secretaries yet.
        </p>
      )}
      {value.map((s, idx) => (
        <div
          key={idx}
          className="flex items-center gap-2 bg-[var(--color-surface-2)] rounded-md p-2"
        >
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] w-6 shrink-0 text-center">
            {idx === 0 ? "★" : idx + 1}
          </div>
          <input
            type="text"
            disabled={disabled}
            value={s.name}
            placeholder="Name"
            onChange={(e) => update(idx, { name: e.target.value })}
            className="flex-1 min-w-0 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-sm"
          />
          <input
            type="number"
            disabled={disabled}
            value={s.userId || ""}
            placeholder="user id"
            onChange={(e) => update(idx, { userId: Number(e.target.value) || 0 })}
            className="w-32 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-sm"
          />
          <div className="flex gap-0.5 shrink-0">
            <button
              disabled={disabled || idx === 0}
              onClick={() => move(idx, -1)}
              className="text-xs px-1.5 py-1 rounded hover:bg-[var(--color-surface)] disabled:opacity-30"
              aria-label="move up"
            >
              ▲
            </button>
            <button
              disabled={disabled || idx === value.length - 1}
              onClick={() => move(idx, 1)}
              className="text-xs px-1.5 py-1 rounded hover:bg-[var(--color-surface)] disabled:opacity-30"
              aria-label="move down"
            >
              ▼
            </button>
            <button
              disabled={disabled}
              onClick={() => remove(idx)}
              className="text-xs px-2 py-1 rounded text-red-400 hover:bg-red-900/30 disabled:opacity-30"
              aria-label="remove"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      <button
        disabled={disabled}
        onClick={add}
        className="text-xs px-3 py-2 rounded-md border border-dashed border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 self-start"
      >
        + Add secretary
      </button>
    </div>
  );
}

function ModelsEditor({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (list: string[]) => void;
  disabled: boolean;
}) {
  const knownIds = new Set(KNOWN_MODELS.map((m) => m.id));
  const available = KNOWN_MODELS.filter((m) => !value.includes(m.id));
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    onChange(next);
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function add(id: string) {
    if (!id) return;
    onChange([...value, id]);
  }
  function sortByCost() {
    const rateOf = (id: string) =>
      KNOWN_MODELS.find((m) => m.id === id)?.in ?? Infinity;
    onChange([...value].sort((a, b) => rateOf(a) - rateOf(b)));
  }
  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="text-xs text-[var(--color-text-dim)]">
          Using the default OPENROUTER_MODEL only.
        </p>
      )}
      {value.map((id, idx) => {
        const meta = KNOWN_MODELS.find((m) => m.id === id);
        return (
          <div
            key={`${id}-${idx}`}
            className="flex items-center gap-2 bg-[var(--color-surface-2)] rounded-md p-2"
          >
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] w-6 shrink-0 text-center">
              {idx === 0 ? "★" : idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{meta?.label ?? id}</div>
              <div className="text-[10px] text-[var(--color-text-dim)] truncate">
                {id}
                {meta && (
                  <span className="ml-2">
                    in ${meta.in}/M · out ${meta.out}/M
                  </span>
                )}
                {!meta && <span className="ml-2 italic">unknown pricing</span>}
              </div>
            </div>
            <div className="flex gap-0.5 shrink-0">
              <button
                disabled={disabled || idx === 0}
                onClick={() => move(idx, -1)}
                className="text-xs px-1.5 py-1 rounded hover:bg-[var(--color-surface)] disabled:opacity-30"
              >
                ▲
              </button>
              <button
                disabled={disabled || idx === value.length - 1}
                onClick={() => move(idx, 1)}
                className="text-xs px-1.5 py-1 rounded hover:bg-[var(--color-surface)] disabled:opacity-30"
              >
                ▼
              </button>
              <button
                disabled={disabled}
                onClick={() => remove(idx)}
                className="text-xs px-2 py-1 rounded text-red-400 hover:bg-red-900/30 disabled:opacity-30"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2 items-center mt-1">
        <select
          disabled={disabled}
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value;
            e.target.value = "";
            add(v);
          }}
          className="text-xs px-2 py-1.5 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]"
        >
          <option value="" disabled>
            + Add a known model…
          </option>
          {available.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — in ${m.in}/M, out ${m.out}/M
            </option>
          ))}
        </select>
        <input
          type="text"
          disabled={disabled}
          placeholder="…or paste any OpenRouter id"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const t = e.currentTarget.value.trim();
              if (t) {
                add(t);
                e.currentTarget.value = "";
              }
            }
          }}
          className="text-xs px-2 py-1.5 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] flex-1 min-w-[160px]"
        />
        <button
          type="button"
          disabled={disabled || value.length < 2}
          onClick={sortByCost}
          className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
        >
          💵 Sort cheapest first
        </button>
      </div>
      {value.some((id) => !knownIds.has(id)) && (
        <p className="text-[11px] text-[var(--color-text-dim)] mt-1">
          Models without a built-in price won't contribute to cost predictions.
        </p>
      )}
    </div>
  );
}
