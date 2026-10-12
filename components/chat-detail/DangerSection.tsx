"use client";

import { useState } from "react";
import Section from "@/components/ui/Section";
import { confirmDialog } from "@/components/ui/Dialogs";
import { ActionRow, Note, Stack, SubBlock, ToggleRow, btnCls, btnDangerCls, fa, inputCls } from "./shared";
import type { Rule } from "./types";

type Preview = { messages: number; reactions: number; oldestAt: string | null; newestAt: string | null };

// Deleting old history is irreversible, so it is previewed first and confirmed in-app.
function ChatHistoryPurge({ chatId }: { chatId: number }) {
  const [days, setDays] = useState(30);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [purging, setPurging] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [dedupeBusy, setDedupeBusy] = useState(false);
  const [dedupeMsg, setDedupeMsg] = useState<string | null>(null);

  const dedupeSms = async () => {
    if (!(await confirmDialog("دوبل‌های SMS رو پاک کنم؟ از هر گروه پیام مشابه (در فاصله ۵ دقیقه) فقط قدیمی‌ترین می‌مونه.", { confirmLabel: "پاک کن", danger: true }))) return;
    setDedupeBusy(true);
    setDedupeMsg(null);
    try {
      const r = await fetch(`/api/chats/${chatId}/dedupe-sms`, { method: "POST" });
      if (r.ok) {
        const j = (await r.json()) as { removed: number; reactions: number };
        setDedupeMsg(j.removed === 0 ? "هیچ دوبل‌ی پیدا نشد." : `✅ ${fa(j.removed)} دوبل پاک شد. صفحه رو رفرش کن.`);
      } else {
        setDedupeMsg(`❌ HTTP ${fa(r.status)}`);
      }
    } finally {
      setDedupeBusy(false);
    }
  };

  const runPreview = async () => {
    setPreviewLoading(true);
    setResult(null);
    try {
      const r = await fetch(`/api/chats/${chatId}/history?days=${days}`);
      if (r.ok) setPreview(await r.json());
    } finally {
      setPreviewLoading(false);
    }
  };

  const purge = async () => {
    if (!preview || preview.messages === 0) return;
    if (!(await confirmDialog(`${fa(preview.messages)} پیام + ${fa(preview.reactions)} ری‌اکشن قدیمی‌تر از ${fa(days)} روز برای همیشه پاک بشه؟ این عملیات قابل بازگشت نیست.`, { confirmLabel: "پاک کن", danger: true }))) return;
    setPurging(true);
    setResult(null);
    try {
      const r = await fetch(`/api/chats/${chatId}/history?days=${days}`, { method: "DELETE" });
      if (r.ok) {
        const j = (await r.json()) as { messages: number; reactions: number };
        setResult(`✅ ${fa(j.messages)} پیام + ${fa(j.reactions)} ری‌اکشن پاک شد.`);
        setPreview(null);
      } else {
        setResult(`❌ HTTP ${fa(r.status)}`);
      }
    } finally {
      setPurging(false);
    }
  };

  return (
    <>
      <SubBlock title="🗑 پاک کردن تاریخچه قدیمی"
        hint={<>پیام‌های قدیمی‌تر از این مدت رو از <code dir="ltr">messages_log</code> پاک می‌کنه + ری‌اکشن‌های متناظر. این عملیات قابل بازگشت نیست — خوبه قبل از حذف یه پیش‌نمایش بگیری.</>}>
        <select aria-label="مدت" value={days} disabled={previewLoading || purging} className={inputCls}
          onChange={(e) => {
            setDays(Number(e.target.value));
            setPreview(null);
            setResult(null);
          }}>
          <option value={7}>قدیمی‌تر از ۷ روز</option>
          <option value={14}>قدیمی‌تر از ۱۴ روز</option>
          <option value={30}>قدیمی‌تر از ۳۰ روز</option>
          <option value={60}>قدیمی‌تر از ۶۰ روز</option>
          <option value={90}>قدیمی‌تر از ۹۰ روز</option>
          <option value={180}>قدیمی‌تر از ۶ ماه</option>
          <option value={365}>قدیمی‌تر از ۱ سال</option>
        </select>
        <ActionRow>
          <button type="button" onClick={runPreview} disabled={previewLoading || purging} className={btnCls}>{previewLoading ? "..." : "🔢 پیش‌نمایش"}</button>
          {preview && preview.messages > 0 && (
            <button type="button" onClick={purge} disabled={purging} className={btnDangerCls}>{purging ? "..." : `🗑 پاک کن (${fa(preview.messages)} پیام)`}</button>
          )}
        </ActionRow>
        {preview && (
          <Note>
            {preview.messages === 0
              ? `هیچ پیامی قدیمی‌تر از ${fa(days)} روز نیست.`
              : `${fa(preview.messages)} پیام + ${fa(preview.reactions)} ری‌اکشن. قدیمی‌ترین: ${preview.oldestAt ? new Date(preview.oldestAt).toLocaleDateString("fa-IR") : "—"}، جدیدترین: ${preview.newestAt ? new Date(preview.newestAt).toLocaleDateString("fa-IR") : "—"}`}
          </Note>
        )}
        {result && <Note>{result}</Note>}
      </SubBlock>
      <SubBlock title="🧹 دوبل‌های SMS" hint="پیام‌های SMS که در فاصله کوتاه با متن یکسان چند بار لاگ شدن رو پاک می‌کنه">
        <ActionRow>
          <button type="button" onClick={dedupeSms} disabled={dedupeBusy} className={btnDangerCls}>{dedupeBusy ? "..." : "🧹 پاک کردن دوبل‌های SMS"}</button>
        </ActionRow>
        {dedupeMsg && <Note>{dedupeMsg}</Note>}
      </SubBlock>
    </>
  );
}

// Destructive / "treat this chat as if it did not exist" actions, kept last and closed.
export default function DangerSection({ chatId, rule, saving, onIgnore }: { chatId: number; rule: Rule | null; saving: boolean; onIgnore: (v: boolean) => void }) {
  return (
    <Section icon="⚠️" title="منطقه خطر" summary={rule?.ignored ? "این چت ignore شده" : "ignore کامل، پاک‌سازی تاریخچه و دوبل‌ها"}>
      <Stack>
        <SubBlock title="🚫 نادیده گرفتن کامل"
          hint="وقتی روشن می‌شه، bot به‌صورت کامل این چت رو نادیده می‌گیره — هیچ classify، هیچ log، هیچ rule eval، هیچ SMS route، هیچ auto-reply. مثل اینه که این چت اصلاً وجود نداره برای سیستم.">
          <ToggleRow label="این چت کلاً ignore بشه" checked={!!rule?.ignored} disabled={saving} onChange={onIgnore} />
        </SubBlock>
        <ChatHistoryPurge chatId={chatId} />
      </Stack>
    </Section>
  );
}
