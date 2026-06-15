"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Badge, Card, PageTitle } from "@/components/Card";

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
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/secretary-relays");
      if (r.ok) {
        const j = (await r.json()) as { relays: Relay[] };
        setList(j.relays ?? []);
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
      if (
        !confirm(
          `«${name}» پاک بشه؟ هر پیامی که از مبدا این Route می‌اومد دیگه فوروارد نمی‌شه.`,
        )
      )
        return;
      await fetch(`/api/secretary-relays/${id}`, { method: "DELETE" });
      load();
    },
    [load],
  );

  return (
    <Shell>
      <PageTitle
        title="🧑‍💼 Secretary Routes"
        subtitle="هر Route یک لیست از فرستنده‌ها (DMها) و یک لیست از گیرنده‌ها داره. هر پیامی از یک فرستنده برای همه‌ی گیرنده‌ها فوروارد می‌شه و جواب گیرنده‌ها مستقیم به‌جای شما برمی‌گرده. لازم نیست حالت secretary رو روی چت ست کنی."
      />

      <Card className="mb-4">
        <div className="text-xs font-medium mb-2">+ Route جدید</div>
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="اسم Route (مثلاً «منشی‌های کاری»)"
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
      </Card>

      {loading ? (
        <Card>Loading…</Card>
      ) : list.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            هیچ Route ای ساخته نشده. بالا اولیشو بساز.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {list.map((relay) => (
            <RelayCard
              key={relay.id}
              relay={relay}
              onRename={rename}
              onToggle={toggle}
              onDelete={remove}
              onChange={load}
            />
          ))}
        </div>
      )}
    </Shell>
  );
}

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
  return (
    <Card>
      <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            defaultValue={relay.name}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== relay.name) onRename(relay.id, v);
            }}
            className="text-sm font-medium bg-transparent border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none px-1 py-0.5"
          />
          {relay.enabled ? (
            <Badge tone="success">on</Badge>
          ) : (
            <Badge tone="neutral">off</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={relay.enabled}
              onChange={(e) => onToggle(relay.id, e.target.checked)}
            />
            enabled
          </label>
          <button
            onClick={() => onDelete(relay.id, relay.name)}
            className="text-[10px] text-red-300 hover:text-red-200 px-2 py-0.5 rounded-md border border-red-900/40 hover:bg-red-900/30"
          >
            🗑 پاک
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <PartyList
          relayId={relay.id}
          kind="sources"
          title="📥 فرستنده‌ها (Sources)"
          help="chat ID افرادی که می‌خوای پیام‌هاشون فوروارد بشه. به‌محض اینکه پیامی از این چت بیاد، برای تمام گیرنده‌ها فرستاده می‌شه — لازم نیست chat mode رو دستی تغییر بدی."
          parties={relay.sources}
          onChange={onChange}
        />
        <PartyList
          relayId={relay.id}
          kind="recipients"
          title="📤 گیرنده‌ها (Recipients)"
          help="chat ID منشی‌هایی که قراره پیام‌ها رو دریافت کنن. باید قبلاً /start رو روی بات زده باشن."
          parties={relay.recipients}
          onChange={onChange}
        />
      </div>
    </Card>
  );
}

function PartyList({
  relayId,
  kind,
  title,
  help,
  parties,
  onChange,
}: {
  relayId: number;
  kind: "sources" | "recipients";
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
    <div className="border border-[var(--color-border)] rounded-md p-3">
      <div className="text-xs font-medium mb-1.5">{title}</div>
      <p className="text-[10px] text-[var(--color-text-dim)] mb-2 leading-relaxed">
        {help}
      </p>

      <div className="flex flex-col gap-1.5 mb-2">
        {parties.length === 0 ? (
          <p className="text-[10px] text-[var(--color-text-dim)] italic">
            (خالی)
          </p>
        ) : (
          parties.map((p) => (
            <div
              key={p.chatId}
              className="flex items-center justify-between gap-2 bg-[var(--color-surface-2)] rounded-md px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <code className="text-[11px] tabular-nums" dir="ltr">
                  {p.chatId}
                </code>
                {p.label && (
                  <span className="text-[10px] text-[var(--color-text-dim)] mr-2 ms-2">
                    {p.label}
                  </span>
                )}
              </div>
              <button
                onClick={() => remove(p.chatId)}
                className="text-[10px] text-red-300 hover:text-red-200 px-1.5 py-0.5 rounded"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <input
          type="text"
          inputMode="numeric"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          placeholder="chat ID"
          dir="ltr"
          className="text-[11px] tabular-nums bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
        />
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="برچسب اختیاری"
          className="text-[11px] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
        />
        <button
          onClick={add}
          disabled={busy || !chatId.trim()}
          className="text-[11px] px-2 py-1 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          + اضافه
        </button>
      </div>
    </div>
  );
}
