"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { PageTitle, Badge } from "@/components/Card";
import Section from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { CopyBtn, ErrorBox, Field, LoadingBox, Segmented, Switch, SummaryBar, UrlBox, btnDanger, btnGhost, btnPrimary, cardCls, fa, inputCls } from "@/components/tool-pages/Controls";
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
  const [error, setError] = useState(false);
  const [origin, setOrigin] = useState("");
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<WebhookKind>("sms");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const r = await fetch("/api/webhooks");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { webhooks: Webhook[] };
      setList(j.webhooks ?? []);
    } catch {
      setError(true);
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

  const put = useCallback(
    async (id: number, body: Record<string, unknown>) => {
      await fetch(`/api/webhooks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: number, name: string) => {
      if (!(await confirmDialog(`«${name}» پاک بشه؟ هر اپی که با این توکن می‌فرسته از کار می‌افته.`, { danger: true, confirmLabel: "پاک کن" }))) return;
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

  const on = list.filter((w) => w.enabled).length;

  return (
    <Shell>
      <div className="max-w-2xl mx-auto">
        <PageTitle
          title="📡 Webhooks"
          subtitle="هر webhook یه ورودی مستقل با اسم و URL خودش. دو نوع: SMS (واسه SMS-Forwarder اندروید) و Insta (واسه سرویس notify اینستاگرام)."
        />

        <Section icon="➕" title="webhook جدید" summary="اسم و نوع را انتخاب کن" key={!loading && !error && list.length === 0 ? "empty" : "list"} defaultOpen={!loading && !error && list.length === 0}>
          <div className="flex flex-col gap-3">
            <Segmented value={newKind} onChange={setNewKind} options={[{ id: "sms", label: "📱 SMS" }, { id: "insta", label: "📷 Insta notify" }]} />
            <Field label="اسم">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={newKind === "insta" ? "اسم (مثلاً «notify اصلی»)" : "اسم (مثلاً «📱 سیم‌کارت ۱ مهدی»)"}
                className={inputCls}
                onKeyDown={(e) => {
                  if (e.key === "Enter") create();
                }}
              />
            </Field>
            <p className="text-xs leading-6 text-[var(--color-text-dim)]">
              {newKind === "insta"
                ? "URL برای سرویس notify اینستا. به شکل token + action + id آماده می‌شه؛ توی URL کلمه‌ی <USERNAME> رو با یوزرنیم اکانت عوض کن."
                : "توکن خودکار generate می‌شه؛ نمی‌تونی همون توکن رو بعداً ببینی توی لاگ‌ها — URL کامل رو همینجا کپی کن."}
            </p>
            <div className="flex">
              <button onClick={create} disabled={creating || !newName.trim()} className={btnPrimary}>
                {creating ? "..." : "بساز"}
              </button>
            </div>
          </div>
        </Section>

        {!loading && !error && list.length > 0 && (
          <SummaryBar items={[{ text: `${fa(list.length)} webhook` }, { text: `${fa(on)} روشن`, tone: "ok" }, ...(list.length - on > 0 ? [{ text: `${fa(list.length - on)} خاموش` }] : [])]} />
        )}

        {loading ? (
          <LoadingBox />
        ) : error ? (
          <ErrorBox text="دریافت فهرست webhookها ناموفق بود." onRetry={load} />
        ) : list.length === 0 ? (
          <EmptyState icon="📡" title="هیچ webhook ای ساخته نشده" hint="بالا یکی بساز؛ بعد URL کامل را کپی کن و در اپ فرستنده بگذار." />
        ) : (
          <div className="flex flex-col gap-3">
            {list.map((w) => (
              <WebhookCard key={w.id} w={w} url={urlFor(w)} onPut={put} onRemove={remove} />
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}

function WebhookCard({ w, url, onPut, onRemove }: { w: Webhook; url: string; onPut: (id: number, body: Record<string, unknown>) => void; onRemove: (id: number, name: string) => void }) {
  const [more, setMore] = useState(false);
  const rename = async () => {
    const v = (await promptDialog("اسم webhook:", w.name))?.trim();
    if (v && v !== w.name) onPut(w.id, { name: v });
  };
  return (
    <div className={cardCls}>
      <div className="text-sm font-semibold leading-6">{w.name}</div>
      <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
        <Badge tone={w.kind === "insta" ? "info" : "neutral"}>{w.kind === "insta" ? "📷 insta" : "📱 sms"}</Badge>
        {w.enabled ? <Badge tone="success">روشن</Badge> : <Badge tone="neutral">خاموش</Badge>}
        {w.lastUsedAt && <Badge tone="info">آخرین بار {relTime(w.lastUsedAt)}</Badge>}
      </div>

      <div className="mt-3"><UrlBox value={url} /></div>
      <div className="mt-2 flex flex-wrap gap-2">
        <CopyBtn value={url} label="📋 کپی URL" disabled={!url} primary />
        <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className={btnGhost}>{more ? "بستن" : "⚙️ تنظیمات"}</button>
      </div>

      {more && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
          <Switch checked={w.enabled} onChange={(v) => onPut(w.id, { enabled: v })} label="فعال" />
          {w.kind === "sms" && (
            <Switch checked={w.redactPrivate} onChange={(v) => onPut(w.id, { redactPrivate: v })} label="🔒 مخفی کردن پیام‌های خصوصی"
              hint="پیام‌های مکالمه خصوصی رو مخفی کن (AI تشخیص می‌ده — تا «نمایش متن» نزنی، متن نشون داده نمی‌شه)" />
          )}
          <p className="mt-2 text-xs leading-6 text-[var(--color-text-dim)]">
            این URL رو تو اپ SMS-Forwarder اندروید فیلد «Webhook URL» پیست کن. بقیه پارامترها همون که هست بمونه. پیام‌های ورودی با عنوان «{w.name}» تو /messages ثبت می‌شن و از pipeline SMS (gate LLM → owner lookup → forward به sms_inbox → OTP chip) رد می‌شن.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={rename} className={btnGhost}>✏️ تغییر اسم</button>
            <button type="button" onClick={() => onRemove(w.id, w.name)} className={btnDanger}>🗑 پاک</button>
          </div>
        </div>
      )}
    </div>
  );
}
