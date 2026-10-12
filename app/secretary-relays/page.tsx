"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Badge, PageTitle } from "@/components/Card";
import Section, { Pill } from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { ErrorBox, Field, LoadingBox, Switch, SummaryBar, btnDanger, btnGhost, btnPrimary, fa, inputCls } from "@/components/tool-pages/Controls";

type Party = {
  relayId: number;
  chatId: number;
  label: string | null;
  createdAt: string;
};

type Relay = {
  id: number;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  sources: Party[];
  recipients: Party[];
};

export default function SecretaryRelaysPage() {
  const [list, setList] = useState<Relay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const r = await fetch("/api/secretary-relays");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { relays: Relay[] };
      setList(j.relays ?? []);
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
      const r = await fetch("/api/secretary-relays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (r.ok) {
        setNewName("");
        load();
      }
    } finally {
      setCreating(false);
    }
  }, [newName, load]);

  const rename = useCallback(
    async (id: number, name: string) => {
      await fetch(`/api/secretary-relays/${id}`, {
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
      await fetch(`/api/secretary-relays/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: number, name: string) => {
      if (!(await confirmDialog(`«${name}» پاک بشه؟ هر پیامی که از مبدا این مسیر می‌اومد دیگه فوروارد نمی‌شه.`, { danger: true, confirmLabel: "پاک کن" }))) return;
      await fetch(`/api/secretary-relays/${id}`, { method: "DELETE" });
      load();
    },
    [load],
  );

  const on = list.filter((r) => r.enabled).length;

  return (
    <Shell>
      <div className="max-w-2xl mx-auto">
        <PageTitle
          title="🧑‍💼 مسیرهای منشی"
          subtitle="ارتباط مستقیم از طریق اکانت Telegram شما — نه از طریق بات."
        />

        <Section icon="ℹ️" title="نحوه‌ی کار">
          <p className="text-sm leading-7 text-[var(--color-text-dim)]">
            پیام فرستنده‌ها توی چت معمولی شما با گیرنده‌ها (از طرف خودتون) ظاهر می‌شه. گیرنده هم توی همون چت معمولی جواب می‌ده و جوابش مستقیم برای فرستنده ارسال می‌شه. پیش‌شرط: هم گیرنده هم فرستنده باید قبلاً توی DM‌های شما باشن.
          </p>
        </Section>

        <Section icon="➕" title="مسیر جدید" summary="یک اسم برای مسیر" key={!loading && !error && list.length === 0 ? "empty" : "list"} defaultOpen={!loading && !error && list.length === 0}>
          <div className="flex flex-col gap-3">
            <Field label="اسم مسیر">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="اسم مسیر (مثلاً «منشی‌های کاری»)"
                className={inputCls}
                onKeyDown={(e) => {
                  if (e.key === "Enter") create();
                }}
              />
            </Field>
            <div className="flex">
              <button onClick={create} disabled={creating || !newName.trim()} className={btnPrimary}>
                {creating ? "..." : "بساز"}
              </button>
            </div>
          </div>
        </Section>

        {!loading && !error && list.length > 0 && (
          <SummaryBar items={[{ text: `${fa(list.length)} مسیر` }, { text: `${fa(on)} روشن`, tone: "ok" }]} />
        )}

        {loading ? (
          <LoadingBox />
        ) : error ? (
          <ErrorBox text="دریافت مسیرها ناموفق بود." onRetry={load} />
        ) : list.length === 0 ? (
          <EmptyState icon="🧑‍💼" title="هیچ مسیری ساخته نشده" hint="بالا اولیشو بساز؛ بعد فرستنده‌ها و گیرنده‌ها را اضافه کن." />
        ) : (
          list.map((relay) => (
            <RelayCard key={relay.id} relay={relay} onRename={rename} onToggle={toggle} onDelete={remove} onChange={load} />
          ))
        )}
      </div>
    </Shell>
  );
}

// One relay = one collapsible row (name, counts, on/off); inside: its settings and the two party lists.
function RelayCard({
  relay,
  onRename,
  onToggle,
  onDelete,
  onChange,
}: {
  relay: Relay;
  onRename: (id: number, name: string) => void;
  onToggle: (id: number, enabled: boolean) => void;
  onDelete: (id: number, name: string) => void;
  onChange: () => void;
}) {
  const rename = async () => {
    const v = (await promptDialog("اسم مسیر:", relay.name))?.trim();
    if (v && v !== relay.name) onRename(relay.id, v);
  };
  return (
    <Section icon="🧑‍💼" title={relay.name} summary={`${fa(relay.sources.length)} فرستنده · ${fa(relay.recipients.length)} گیرنده`}
      badge={relay.enabled ? <Badge tone="success">روشن</Badge> : <Badge tone="neutral">خاموش</Badge>}>
      <Switch checked={relay.enabled} onChange={(v) => onToggle(relay.id, v)} label="فعال" />
      <div className="mt-1 mb-4 flex flex-wrap gap-2">
        <button type="button" onClick={rename} className={btnGhost}>✏️ تغییر اسم</button>
        <button type="button" onClick={() => onDelete(relay.id, relay.name)} className={btnDanger}>🗑 پاک</button>
      </div>

      <div className="pt-3 border-t border-[var(--color-border)] [&>section:last-child]:mb-0">
        <PartyList
          relayId={relay.id}
          kind="sources"
          icon="📥"
          title="فرستنده‌ها (Sources)"
          help="chat ID افرادی که می‌خوای پیام‌هاشون فوروارد بشه. به‌محض اینکه پیامی از این چت بیاد، برای تمام گیرنده‌ها فرستاده می‌شه — لازم نیست chat mode رو دستی تغییر بدی."
          parties={relay.sources}
          onChange={onChange}
        />
        <PartyList
          relayId={relay.id}
          kind="recipients"
          icon="📤"
          title="گیرنده‌ها (Recipients)"
          help="chat ID گیرنده‌ها — کسانی که قراره پیام‌های فرستنده‌ها رو دریافت کنن. این چت باید توی DM‌های اکانت شخصی شما باشه (شما باید یه conversation با این فرد داشته باشید) تا بات بتونه از طرف شما براش پیام بفرسته."
          parties={relay.recipients}
          onChange={onChange}
        />
      </div>
    </Section>
  );
}

function PartyList({
  relayId,
  kind,
  icon,
  title,
  help,
  parties,
  onChange,
}: {
  relayId: number;
  kind: "sources" | "recipients";
  icon: string;
  title: string;
  help: string;
  parties: Party[];
  onChange: () => void;
}) {
  const [chatId, setChatId] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const idField = kind === "sources" ? "sourceChatId" : "recipientChatId";

  const add = async () => {
    const id = Number(chatId.trim());
    if (!Number.isFinite(id) || id === 0) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/secretary-relays/${relayId}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [idField]: id, label: label.trim() }),
      });
      if (r.ok) {
        setChatId("");
        setLabel("");
        onChange();
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    await fetch(
      `/api/secretary-relays/${relayId}/${kind}?${idField}=${id}`,
      { method: "DELETE" },
    );
    onChange();
  };

  return (
    <Section icon={icon} title={title} summary={parties.length === 0 ? "(خالی)" : undefined} badge={<Pill>{fa(parties.length)}</Pill>}>
      <p className="mb-3 text-xs leading-6 text-[var(--color-text-dim)]">{help}</p>

      {parties.length > 0 && (
        <div className="flex flex-col gap-2 mb-3">
          {parties.map((p) => (
            <div key={p.chatId} className="flex items-center gap-2 min-h-12 bg-[var(--color-surface-2)] rounded-xl ps-3 pe-1">
              <div className="min-w-0 flex-1 text-center">
                <code className="block text-sm tabular-nums" dir="ltr">{p.chatId}</code>
                {p.label && <span className="block text-xs text-[var(--color-text-dim)] truncate">{p.label}</span>}
              </div>
              <button onClick={() => remove(p.chatId)} aria-label={`حذف ${p.chatId}`} className="min-w-10 rounded-xl text-rose-300 active:bg-rose-500/10">✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Field label="chat ID">
          <input type="text" inputMode="numeric" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="chat ID" dir="ltr" className={`${inputCls} tabular-nums`} />
        </Field>
        <Field label="برچسب (اختیاری)">
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="برچسب اختیاری" className={inputCls} />
        </Field>
        <div className="flex">
          <button onClick={add} disabled={busy || !chatId.trim()} className={btnPrimary}>+ اضافه</button>
        </div>
      </div>
    </Section>
  );
}
