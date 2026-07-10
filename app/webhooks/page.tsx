"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime } from "@/lib/format";

type WebhookKind = "sms" | "insta";

type Webhook = {
  id: number;
  name: string;
  secret: string;
  enabled: boolean;
  kind: WebhookKind;
  redactPrivate: boolean;
  lastUsedAt: string | null;
  createdAt: string;
};

export default function WebhooksPage() {
  const [list, setList] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState("");
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<WebhookKind>("sms");
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/webhooks");
      if (r.ok) {
        const j = (await r.json()) as { webhooks: Webhook[] };
        setList(j.webhooks ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), kind: newKind }),
      });
      if (r.ok) {
        setNewName("");
        load();
      }
    } finally {
      setCreating(false);
    }
  }, [newName, newKind, load]);

  const rename = useCallback(
    async (id: number, name: string) => {
      await fetch(`/api/webhooks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      load();
    },
    [load],
  );

  const toggle = useCallback(
    async (id: number, enabled: boolean) => {
      await fetch(`/api/webhooks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      load();
    },
    [load],
  );

  const toggleRedact = useCallback(
    async (id: number, redactPrivate: boolean) => {
      await fetch(`/api/webhooks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redactPrivate }),
      });
      load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: number, name: string) => {
      if (!confirm(`«${name}» پاک بشه؟ هر اپی که با این توکن می‌فرسته از کار می‌افته.`))
        return;
      await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
      load();
    },
    [load],
  );

  const urlFor = (w: Webhook) => {
    if (!origin) return "";
    if (w.kind === "insta") {
      return `${origin}/api/insta-webhook?token=${encodeURIComponent(w.secret)}&action=story&id=<USERNAME>`;
    }
    return `${origin}/api/sms-webhook?token=${encodeURIComponent(w.secret)}`;
  };

  const copy = async (id: number, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  };

  return (
    <Shell>
      <PageTitle
        title="📡 Webhooks"
        subtitle="هر webhook یه ورودی مستقل با اسم و URL خودش. دو نوع: SMS (واسه SMS-Forwarder اندروید) و Insta (واسه سرویس notify اینستاگرام)."
      />

      <Card className="mb-4">
        <div className="text-xs font-medium mb-2">+ webhook جدید</div>
        <div className="flex gap-2 flex-wrap mb-2">
          <button
            type="button"
            onClick={() => setNewKind("sms")}
            className={`text-[11px] px-3 py-1 rounded-md border ${
              newKind === "sms"
                ? "bg-[var(--color-accent)] text-white border-transparent"
                : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            📱 SMS
          </button>
          <button
            type="button"
            onClick={() => setNewKind("insta")}
            className={`text-[11px] px-3 py-1 rounded-md border ${
              newKind === "insta"
                ? "bg-[var(--color-accent)] text-white border-transparent"
                : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            📷 Insta notify
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={
              newKind === "insta"
                ? "اسم (مثلاً «notify اصلی»)"
                : "اسم (مثلاً «📱 سیم‌کارت ۱ مهدی»)"
            }
            className="flex-1 min-w-[200px] text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-1.5"
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />
          <button
            onClick={create}
            disabled={creating || !newName.trim()}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
          >
            {creating ? "..." : "بساز"}
          </button>
        </div>
        <p className="text-[10px] text-[var(--color-text-dim)] mt-2">
          {newKind === "insta"
            ? "URL برای سرویس notify اینستا. به شکل token + action + id آماده می‌شه؛ توی URL کلمه‌ی <USERNAME> رو با یوزرنیم اکانت عوض کن."
            : "توکن خودکار generate می‌شه؛ نمی‌تونی همون توکن رو بعداً ببینی توی لاگ‌ها — URL کامل رو همینجا کپی کن."}
        </p>
      </Card>

      {loading ? (
        <Card>بارگذاری…</Card>
      ) : list.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            هیچ webhook ای ساخته نشده. بالا یکی بساز.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((w) => {
            const url = urlFor(w);
            return (
              <Card key={w.id} className="!p-3">
                <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      defaultValue={w.name}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== w.name) rename(w.id, v);
                      }}
                      className="text-sm font-medium bg-transparent border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none px-1 py-0.5"
                    />
                    <Badge tone={w.kind === "insta" ? "info" : "neutral"}>
                      {w.kind === "insta" ? "📷 insta" : "📱 sms"}
                    </Badge>
                    {w.enabled ? (
                      <Badge tone="success">روشن</Badge>
                    ) : (
                      <Badge tone="neutral">خاموش</Badge>
                    )}
                    {w.lastUsedAt && (
                      <Badge tone="info">
                        آخرین بار {relTime(w.lastUsedAt)}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={w.enabled}
                        onChange={(e) => toggle(w.id, e.target.checked)}
                      />
                      فعال
                    </label>
                    <button
                      onClick={() => remove(w.id, w.name)}
                      className="text-[10px] text-red-300 hover:text-red-200 px-2 py-0.5 rounded-md border border-red-900/40 hover:bg-red-900/30"
                    >
                      🗑 پاک
                    </button>
                  </div>
                </div>
                {w.kind === "sms" && (
                  <label className="flex items-center gap-2 cursor-pointer text-[10px] text-[var(--color-text-dim)] mb-2 -mt-1">
                    <input
                      type="checkbox"
                      checked={w.redactPrivate}
                      onChange={(e) => toggleRedact(w.id, e.target.checked)}
                    />
                    🔒 پیام‌های مکالمه خصوصی رو مخفی کن (AI تشخیص می‌ده — تا «نمایش متن» نزنی، متن نشون داده نمی‌شه)
                  </label>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <code
                    dir="ltr"
                    className="flex-1 min-w-0 text-[11px] tabular-nums break-all bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
                  >
                    {url || "…"}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(w.id, url)}
                    disabled={!url}
                    className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
                  >
                    {copiedId === w.id ? "✓ کپی شد" : "📋 کپی"}
                  </button>
                </div>
                <p className="text-[10px] text-[var(--color-text-dim)] mt-2">
                  این URL رو تو اپ SMS-Forwarder اندروید فیلد «Webhook URL»
                  پیست کن. بقیه پارامترها همون که هست بمونه. پیام‌های
                  ورودی با عنوان «{w.name}» تو /messages ثبت می‌شن و از
                  pipeline SMS (gate LLM → owner lookup → forward به
                  sms_inbox → OTP chip) رد می‌شن.
                </p>
              </Card>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
