"use client";

import Link from "next/link";
import Section from "@/components/ui/Section";
import { ActionRow, Field, Note, Stack, SubBlock, ToggleRow, btnCls, btnPrimaryCls, inputCls } from "./shared";
import PhoneField from "./PhoneField";
import { RELATIONSHIP_LABELS, type Personal, type Relationship, type Rule } from "./types";

const areaCls = `${inputCls} leading-7 resize-y`;

function SaveRow({ saving, dirty, saved, onSave }: { saving: boolean; dirty: boolean; saved: boolean; onSave: () => void }) {
  return (
    <div>
      {dirty && <Note tone="warn">تغییرات ذخیره‌نشده</Note>}
      {saved && !dirty && <Note tone="ok">✓ ذخیره شد</Note>}
      <ActionRow>
        <button type="button" onClick={onSave} disabled={saving || !dirty} className={btnPrimaryCls}>{saving ? "در حال ذخیره…" : "ذخیره"}</button>
      </ActionRow>
    </div>
  );
}

// Who this chat is: the personal form (private chats), the bot form, or the channel/group context, plus the
// phone number and the "this chat is a bot" switch. All three forms share one draft (`personal`).
export default function IdentitySection({ chatId, rule, personal, updatePersonal, dirty, saved, saving, onSave, suggesting, suggestError, onSuggest, onToggleBot, onReload }: {
  chatId: number;
  rule: Rule | null;
  personal: Personal;
  updatePersonal: (patch: Partial<Personal>) => void;
  dirty: boolean;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
  suggesting: boolean;
  suggestError: string | null;
  onSuggest: () => void;
  onToggleBot: (v: boolean) => void;
  onReload: () => void;
}) {
  const isPrivateChat = chatId > 0 && rule?.chatType === "private";
  const showPersonal = isPrivateChat && !rule?.isBot;
  const showBot = Boolean(rule?.isBot);
  const showGroup = rule?.chatType !== "private" && !rule?.isBot;
  const save = <SaveRow saving={saving} dirty={dirty} saved={saved} onSave={onSave} />;

  const summary = showPersonal
    ? [rule?.nickname, rule?.relationship && RELATIONSHIP_LABELS[rule.relationship], rule?.phoneNumber].filter(Boolean).join(" · ") || "نام، رابطه، یادداشت و شماره"
    : showBot ? "اسم سفارشی و یادداشت بات" : "اسم سفارشی، یادداشت و شماره";

  return (
    <Section icon="🪪" title="هویت و یادداشت‌ها" summary={summary}>
      <Stack>
        {showPersonal && (
          <SubBlock title="اطلاعات شخصی" hint="AI ازش برای تنظیم لحن استفاده می‌کنه">
            <div className="mb-3">
              <div className="flex [justify-content:left]">
                <button type="button" onClick={onSuggest} disabled={suggesting} className={btnCls}
                  title="AI پیام‌های این چت رو می‌خونه و فیلدها رو پیشنهاد می‌ده (فارسی)">{suggesting ? "در حال…" : "🤖 پیشنهاد AI"}</button>
              </div>
              {suggestError && <Note tone="bad">{suggestError}</Note>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="نام"><input dir="auto" type="text" disabled={saving} value={personal.firstName} placeholder="—" className={inputCls}
                onChange={(e) => updatePersonal({ firstName: e.target.value })} /></Field>
              <Field label="نام خانوادگی"><input dir="auto" type="text" disabled={saving} value={personal.lastName} placeholder="—" className={inputCls}
                onChange={(e) => updatePersonal({ lastName: e.target.value })} /></Field>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              <Field label="Nickname" hint="اسم خودمونی که صداش می‌کنیم">
                <input dir="auto" type="text" disabled={saving} value={personal.nickname} placeholder="مثلاً موتی / دادا" className={inputCls}
                  onChange={(e) => updatePersonal({ nickname: e.target.value })} />
              </Field>
              <Field label="رابطه">
                <select disabled={saving} value={personal.relationship} className={inputCls}
                  onChange={(e) => updatePersonal({ relationship: e.target.value as Relationship | "" })}>
                  <option value="">— ست نشده —</option>
                  {(Object.keys(RELATIONSHIP_LABELS) as Relationship[]).map((r) => (
                    <option key={r} value={r}>{RELATIONSHIP_LABELS[r]}</option>
                  ))}
                </select>
              </Field>
              <Field label="شرح رابطه (آزاد)" hint="به AI کمک می‌کنه بدونه طرف کیه">
                <textarea dir="auto" disabled={saving} value={personal.relationshipNotes} rows={2} className={areaCls}
                  placeholder="مثلاً: همکار قدیمی شرکت X، اعتماد کامل، با هم پروژه Y رو می‌بریم"
                  onChange={(e) => updatePersonal({ relationshipNotes: e.target.value })} />
              </Field>
              <Field label="نحوه‌ی صحبت با این فرد" hint="قواعد سفت">
                <textarea dir="auto" disabled={saving} value={personal.talkStyleNotes} rows={2} className={areaCls}
                  placeholder="مثلاً: رسمی، بدون شوخی، همیشه «شما». یا: خودمونی، با اموجی، کوتاه."
                  onChange={(e) => updatePersonal({ talkStyleNotes: e.target.value })} />
              </Field>
              <Field label="📝 Context / Notes" hint="هر چی اینجا بنویسی، توی همه‌ی تحلیل‌های بعدی این چت (classify / summarise / AI reply) به prompt تزریق می‌شه و می‌مونه.">
                <textarea dir="auto" disabled={saving} value={personal.notes} rows={4} className={areaCls}
                  placeholder="مثلاً: راجع به پروژه‌ی X باهاش حرف می‌زنیم، deadline دوشنبه‌ست. یا: این هفته در حال جابه‌جایی‌ام، جزئیات کاری رو موکول کن به هفته‌ی بعد."
                  onChange={(e) => updatePersonal({ notes: e.target.value })} />
              </Field>
            </div>
            {save}
          </SubBlock>
        )}

        {showBot && (
          <SubBlock title="🤖 بات — تنظیمات مستقل"
            hint="این چت با یک bot است. معمولاً نقش function (مثلاً downloader) براش ست می‌کنی و mode رو روی Off می‌ذاری تا AI جوابش رو نده. notes زیر به prompt تزریق می‌شه.">
            <div className="flex flex-col gap-3">
              <Field label="اسم سفارشی" hint="اگه خالی بمونه، نام پیش‌فرض bot استفاده می‌شه">
                <input dir="auto" type="text" disabled={saving} value={personal.firstName} placeholder={rule?.chatTitle ?? "—"} className={inputCls}
                  onChange={(e) => updatePersonal({ firstName: e.target.value })} />
              </Field>
              <Field label="Notes">
                <textarea dir="auto" disabled={saving} value={personal.notes} rows={3} className={areaCls}
                  placeholder="مثلاً: این bot لینک اینستاگرام می‌گیره و فایل می‌فرسته. دستور دانلود: فقط لینک رو بفرست."
                  onChange={(e) => updatePersonal({ notes: e.target.value })} />
              </Field>
            </div>
            {save}
          </SubBlock>
        )}

        {showGroup && (
          <SubBlock title="زمینه کانال / گروه">
            <div className="flex flex-col gap-3">
              <Field label="اسم سفارشی" hint="اگه خالی بمونه، نام پیش‌فرض کانال/گروه استفاده می‌شه">
                <input dir="auto" type="text" disabled={saving} value={personal.firstName} placeholder={rule?.chatTitle ?? "—"} className={inputCls}
                  onChange={(e) => updatePersonal({ firstName: e.target.value })} />
              </Field>
              <Field label="📝 Context / Notes"
                hint="هر چی اینجا بنویسی، توی همه‌ی تحلیل‌های بعدی این چت (classify / summarise) به prompt تزریق می‌شه. مثلاً: «این کانال خبری‌ست — هر چه مربوط به شرکت X باشد مهم است.»">
                <textarea dir="auto" disabled={saving} value={personal.notes} rows={4} className={areaCls}
                  placeholder="توضیح اینکه این کانال/گروه چی هست، چی توش مهمه، آدم‌های کلیدی، …"
                  onChange={(e) => updatePersonal({ notes: e.target.value })} />
              </Field>
            </div>
            {save}
            <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
              <ActionRow>
                <a href={`/api/groups/${chatId}/members?format=csv`} download={`group-${chatId}-members.csv`} className={btnCls}
                  title="فایل CSV با ID عددی، @username و اسم همه‌ی افرادی که توی این گروه پیام دادن">👥 خروجی اعضا (CSV)</a>
                <Link href={`/groups/${chatId}`} className={btnCls}>📊 صفحه تحلیل گروه</Link>
              </ActionRow>
              <p className="mt-3 text-xs leading-6 text-[var(--color-text-dim)]">
                خروجی شامل: هر کسی که پیام داده + هر کسی که از وقتی ربات ادمین شده، join/leave/promote کرده.
                Telegram Bot API لیست کامل اعضای موجود رو retroactive نمی‌ده — اگه ربات تازه ادمین شده، فقط رویدادهای بعد از اون رو می‌گیره.
              </p>
            </div>
          </SubBlock>
        )}

        <SubBlock title="📱 شماره تلفن"
          hint="این شماره برای route کردن SMSهای ورودی و هر فیچر دیگه‌ای که شماره می‌خواد استفاده می‌شه. با + و کد کشور بنویس (مثلاً +989123456789).">
          <PhoneField chatId={chatId} initial={rule?.phoneNumber ?? null} onSaved={onReload} />
        </SubBlock>

        {isPrivateChat && (
          <ToggleRow label="🤖 این چت یک bot است" hint="تشخیص خودکار بر اساس username؛ اگه اشتباه شناسایی شده این رو عوض کن"
            checked={Boolean(rule?.isBot)} disabled={saving} onChange={onToggleBot} />
        )}
      </Stack>
    </Section>
  );
}
