"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";

type Settings = {
  ownerName: string;
  ownerDisplayName: string;
  ownerContext: string;
  ownerAliasesCsv: string;
  ownerJobDescription: string;
  groupPriorityKeywordsCsv: string;
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
  aiChatModelsCsv: string;
  sttLanguage: string;
  markMessagesAsRead: string;
  autoExtractEnabled: string;
  autoExtractMinImportance: string;
  chatDefaultMode: string;
  chatDefaultRelationship: string;
  chatDefaultAutoForwardVoice: string;
  chatDefaultAutoForwardVideo: string;
  chatDefaultAutoForwardPhoto: string;
  chatDefaultAutoForwardLocation: string;
  chatDefaultAutoExtractNotes: string;
  chatDefaultAutoSummarizeEnabled: string;
  chatDefaultAutoSummarizeGapMinutes: string;
  chatDefaultAiProcessVoice: string;
  chatDefaultAiProcessStickers: string;
  chatDefaultAiProcessGifs: string;
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
      {
        key: "ownerAliasesCsv",
        label: "Aliases / nicknames (comma-separated)",
        hint: "Every variant people use to refer to you in groups — first name, family name, common typos, nicknames, @-handles without the @. Example: مهدی, موتی, راستگار, mahdi. The classifier treats any match as you being addressed.",
      },
      {
        key: "ownerJobDescription",
        label: "What you do for work",
        hint: "One short line. Used by the classifier to judge whether a group message is relevant to your job.",
        type: "textarea",
      },
      {
        key: "groupPriorityKeywordsCsv",
        label: "Priority keywords (comma-separated)",
        hint: "Project names, products, deadlines, anything you want flagged automatically. A match bumps importance by ~2 and marks the message as concerning you.",
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
    title: "Secretary",
    fields: [
      {
        key: "secretaryEnabled",
        label: "Enabled",
        type: "toggle",
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
      {
        key: "sttLanguage",
        label: "Transcription language (ISO 639-1)",
        hint: 'Force the audio language instead of letting Whisper guess (Whisper misreads short Persian audio as English). Examples: "fa" Persian, "en" English, "ar" Arabic. Leave empty to auto-detect.',
      },
      {
        key: "markMessagesAsRead",
        label: "Mark sender's message as 'seen' after every reply",
        hint: "When the bot answers via business connection (auto-reply, AI, friendly, secretary relay, or dashboard send), it also calls readBusinessMessage so the sender gets a seen tick. Requires the can_read_messages right in Telegram Business → Chatbots. Turn this OFF if you'd rather not show seen ticks.",
        type: "toggle",
      },
    ],
  },
  {
    title: "Reminders & calendar (AI extract)",
    fields: [
      {
        key: "autoExtractEnabled",
        label: "Automatically extract events / tasks / reminders from messages",
        hint: "After classifying each incoming message, the AI looks for dates, deadlines, and action items and adds them to /reminders. Turn off to extract only when you tap 🧠 Extract manually.",
        type: "toggle",
      },
      {
        key: "autoExtractMinImportance",
        label: "Minimum importance to auto-extract (0-10)",
        hint: "Skip messages classified below this importance to save AI cost. Default 4: ignores ads/spam, processes anything that looks like real conversation.",
        type: "number",
      },
    ],
  },
  {
    title: "پیش‌فرض چت‌های جدید",
    fields: [
      {
        key: "chatDefaultMode",
        label: "Mode پیش‌فرض",
        hint: "وقتی بات اولین بار یه چت رو می‌بینه، rule‌اش با این مقدار ساخته می‌شه. روی هر چت قابل override.",
      },
      {
        key: "chatDefaultRelationship",
        label: "Relationship پیش‌فرض (اختیاری)",
        hint: "خالی = بدون رابطه. مقادیر معتبر: close_family / family / close_friend / friend / work_acquaintance / employer / formal / suspicious / stranger.",
      },
      {
        key: "chatDefaultAutoForwardVoice",
        label: "🎤 auto-forward voice + video-note (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAutoForwardVideo",
        label: "🎬 auto-forward video (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAutoForwardPhoto",
        label: "🖼 auto-forward photo (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAutoForwardLocation",
        label: "📍 auto-forward location (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAutoExtractNotes",
        label: "📒 استخراج خودکار Notes با AI (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAutoSummarizeEnabled",
        label: "📬 Auto-summarize threads (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAutoSummarizeGapMinutes",
        label: "🕐 gap سکوت برای close thread (دقیقه)",
        type: "number",
      },
      {
        key: "chatDefaultAiProcessVoice",
        label: "🎤 AI process voice (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAiProcessStickers",
        label: "🎨 AI process sticker (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAiProcessGifs",
        label: "🎞 AI process GIF (پیش‌فرض)",
        type: "toggle",
      },
    ],
  },
];

const KNOWN_MODELS: Array<{ id: string; in: number; out: number; label: string }> = [
  { id: "google/gemini-2.5-flash-lite", in: 0.1, out: 0.4, label: "Gemini 2.5 Flash Lite" },
  { id: "google/gemini-2.5-flash", in: 0.3, out: 2.5, label: "Gemini 2.5 Flash" },
  { id: "google/gemini-2.5-pro", in: 1.25, out: 10.0, label: "Gemini 2.5 Pro" },
  { id: "anthropic/claude-haiku-4-5", in: 1.0, out: 5.0, label: "Claude Haiku 4.5" },
  { id: "anthropic/claude-sonnet-4-6", in: 3.0, out: 15.0, label: "Claude Sonnet 4.6" },
  { id: "openai/gpt-4o-mini", in: 0.15, out: 0.6, label: "GPT-4o mini" },
];

type Secretary = { userId: number; name: string };

type HeaderPair = { key: string; value: string };

function parseHeaders(json: string): HeaderPair[] {
  try {
    const obj = JSON.parse(json || "{}") as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
    return Object.entries(obj as Record<string, unknown>).map(([key, v]) => ({
      key,
      value: typeof v === "string" ? v : JSON.stringify(v),
    }));
  } catch {
    return [];
  }
}

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
  // Admin can edit a specific tenant's overrides via ?tenant=<id>.
  // The route enforces admin-ness; we just plumb the query param
  // through to every fetch so reads and writes stay consistent.
  const tenantId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("tenant")
      : null;
  const tenantQuery = tenantId
    ? `?tenant=${encodeURIComponent(tenantId)}`
    : "";
  const [tenantName, setTenantName] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/settings${tenantQuery}`);
    if (!r.ok) return;
    const j = (await r.json()) as {
      values: Settings;
      envLocked: Array<keyof Settings>;
      meta?: { defaultModel?: string; tenantId?: number | null; tenantName?: string | null };
    };
    if (j.meta?.tenantName) setTenantName(j.meta.tenantName);

    // Migrate legacy fields so the new editors are pre-populated:
    //  - secretariesJson empty + legacy secretaryUserId set → seed the list
    //  - aiModelsCsv empty + meta.defaultModel known → seed the list
    const v = { ...j.values };
    if (!v.secretariesJson || v.secretariesJson.trim() === "") {
      const legacyId = Number(v.secretaryUserId);
      if (Number.isFinite(legacyId) && legacyId > 0) {
        v.secretariesJson = JSON.stringify([
          { userId: legacyId, name: v.secretaryDisplayName || "Secretary" },
        ]);
      }
    }
    if (
      (!v.aiModelsCsv || v.aiModelsCsv.trim() === "") &&
      j.meta?.defaultModel
    ) {
      v.aiModelsCsv = j.meta.defaultModel;
    }

    setValues(v);
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
      const r = await fetch(`/api/settings${tenantQuery}`, {
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
    "google/gemini-2.5-flash-lite": 0.1,
    "google/gemini-2.5-flash": 0.3,
    "google/gemini-2.5-pro": 1.25,
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
      {tenantId && (
        <div className="mb-3 p-3 rounded-lg border border-amber-700 bg-amber-900/20">
          <div className="text-sm font-medium text-amber-200">
            🏢 Editing tenant: {tenantName ?? `#${tenantId}`}
          </div>
          <div className="text-[11px] text-amber-300/80 mt-1">
            تغییرات روی این tenant ذخیره می‌شن — مقادیر خالی fallback به global.
            برای ویرایش global،{" "}
            <a href="/settings" className="underline">
              برو settings بدون ?tenant
            </a>
            .
          </div>
        </div>
      )}
      <PageTitle
        title={tenantId ? `Settings · ${tenantName ?? `#${tenantId}`}` : "Settings"}
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

      <div className="mb-4 text-[11px]">
        <Link
          href="/settings"
          className="text-[var(--color-text-dim)] hover:text-white underline-offset-2 hover:underline"
        >
          ← برگشت به Settings
        </Link>
      </div>

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
            the bot once so it can DM them). Or send them an invite link
            below and they'll be added automatically when they tap it.
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
          <InviteLinkPanel disabled={envLocked.has("secretariesJson")} />
        </Card>

        {/* Custom rich editor: AI Models — general (classify / summaries) */}
        <Card>
          <h2 className="text-sm font-semibold mb-1">
            AI models — classify &amp; summaries
          </h2>
          <p className="text-xs text-[var(--color-text-dim)] mb-4">
            Used for urgent detection, group summaries, and transcription
            metadata. Tried in order; falls back on failure.
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

        {/* Custom rich editor: AI Models — chat (ai_chat / friendly_reply) */}
        <Card>
          <h2 className="text-sm font-semibold mb-1">
            AI models — chat &amp; friendly reply
          </h2>
          <p className="text-xs text-[var(--color-text-dim)] mb-4">
            Separate list used only when a chat is in <strong>AI chat</strong>{" "}
            or <strong>Friendly auto-reply</strong> mode. Put smarter models
            here (Claude Sonnet, GPT-4o, …) — they only run when a real
            conversation is happening. Leave empty to reuse the classify list.
            {envLocked.has("aiChatModelsCsv") && (
              <span className="ml-2 italic">(locked by env)</span>
            )}
          </p>
          <ModelsEditor
            value={(values.aiChatModelsCsv || "")
              .split(",")
              .map((m) => m.trim())
              .filter(Boolean)}
            disabled={envLocked.has("aiChatModelsCsv")}
            onChange={(list) => update("aiChatModelsCsv", list.join(", "))}
          />
        </Card>

        {/* Custom rich editor: Alert webhook headers */}
        <Card>
          <h2 className="text-sm font-semibold mb-1">
            Alert webhook headers
          </h2>
          <p className="text-xs text-[var(--color-text-dim)] mb-4">
            Extra HTTP headers sent with every alert webhook call.
            {envLocked.has("alertWebhookHeaders") && (
              <span className="ml-2 italic">(locked by env)</span>
            )}
          </p>
          <HeadersEditor
            value={parseHeaders(values.alertWebhookHeaders)}
            disabled={envLocked.has("alertWebhookHeaders")}
            onChange={(pairs) =>
              update(
                "alertWebhookHeaders",
                JSON.stringify(
                  Object.fromEntries(
                    pairs
                      .filter((p) => p.key)
                      .map((p) => [p.key, p.value]),
                  ),
                ),
              )
            }
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

function HeadersEditor({
  value,
  onChange,
  disabled,
}: {
  value: HeaderPair[];
  onChange: (pairs: HeaderPair[]) => void;
  disabled: boolean;
}) {
  function update(idx: number, patch: Partial<HeaderPair>) {
    onChange(value.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...value, { key: "", value: "" }]);
  }
  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="text-xs text-[var(--color-text-dim)]">
          No extra headers.
        </p>
      )}
      {value.map((p, idx) => (
        <div
          key={idx}
          className="flex items-center gap-2 bg-[var(--color-surface-2)] rounded-md p-2"
        >
          <input
            type="text"
            disabled={disabled}
            value={p.key}
            placeholder="Header name (e.g. X-Auth)"
            onChange={(e) => update(idx, { key: e.target.value })}
            className="w-40 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-sm"
          />
          <input
            type="text"
            disabled={disabled}
            value={p.value}
            placeholder="Value"
            onChange={(e) => update(idx, { value: e.target.value })}
            className="flex-1 min-w-0 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-sm"
          />
          <button
            disabled={disabled}
            onClick={() => remove(idx)}
            className="text-xs px-2 py-1 rounded text-red-400 hover:bg-red-900/30 disabled:opacity-30"
            aria-label="remove"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        disabled={disabled}
        onClick={add}
        className="text-xs px-3 py-2 rounded-md border border-dashed border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 self-start"
      >
        + Add header
      </button>
    </div>
  );
}

function InviteLinkPanel({ disabled }: { disabled: boolean }) {
  const [pending, setPending] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      const r = await fetch("/api/secretaries/invite", { method: "POST" });
      const j = (await r.json()) as { url?: string; error?: string };
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setUrl(j.url ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copy failed; select the link manually.");
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <button
          type="button"
          onClick={generate}
          disabled={disabled || pending}
          className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Generating…" : "🔗 Generate invite link"}
        </button>
        <span className="text-[11px] text-[var(--color-text-dim)]">
          Valid for 7 days, single use. Share it on Telegram to add a new
          secretary.
        </span>
      </div>
      {url && (
        <div className="flex items-center gap-2 bg-[var(--color-surface-2)] rounded-md p-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 bg-transparent text-xs"
          />
          <button
            type="button"
            onClick={copy}
            className="text-xs px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface)]"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-xs px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface)]"
          >
            Open
          </a>
        </div>
      )}
      {error && (
        <p className="text-xs text-red-400 mt-2">{error}</p>
      )}
    </div>
  );
}
