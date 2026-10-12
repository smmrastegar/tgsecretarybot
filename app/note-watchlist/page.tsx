"use client";

import Shell from "@/components/Shell";
import { PageTitle } from "@/components/Card";
import Section from "@/components/ui/Section";
import WatchlistPanel from "@/components/WatchlistPanel";

export default function NoteWatchlistPage() {
  return (
    <Shell>
      <PageTitle
        title="🕵️ دیده‌بان یادداشت"
        subtitle="مفاهیمی که اینجا تعریف می‌کنی روی پیام‌های همه‌ی چت‌ها فعاله — global."
      />
      <Section icon="ℹ️" title="فرق با auto_extract_notes" summary="این دیده‌بان چه فرقی با فلگ هر چت دارد؟">
        <p className="text-sm leading-7">
          این با فلگ auto_extract_notes توی هر چت فرق داره: اون مال یه چت خاصه و آدرس/لوکیشن/مخاطب رو بی‌قاعده استخراج می‌کنه؛ Watchlist روی همه‌ی چت‌ها فعاله و فقط دنبال مفاهیم انتخاب‌شده‌ی توست.
        </p>
      </Section>
      <WatchlistPanel />
    </Shell>
  );
}
