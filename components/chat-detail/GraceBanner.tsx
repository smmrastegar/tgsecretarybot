"use client";

import { relTime } from "@/lib/format";
import { btnCls, fa } from "./shared";
import { MODE_LABELS, type GraceInfo, type Rule } from "./types";

// Shown while the bot is held back because the owner just wrote in this chat; one tap ends the pause.
export default function GraceBanner({ rule, grace, nowTick, saving, onSkip }: {
  rule: Rule | null; grace: GraceInfo | null; nowTick: number; saving: boolean; onSkip: () => void;
}) {
  const currentMode = rule?.mode ?? "off";
  if (currentMode === "off" || rule?.vip) return null;
  const last = grace?.lastOwnerSentAt ? new Date(grace.lastOwnerSentAt).getTime() : null;
  const skipped = rule?.graceSkippedAt ? new Date(rule.graceSkippedAt).getTime() : null;
  const graceMs = (grace?.minutes ?? 0) * 60_000;
  if (!last || graceMs <= 0) return null;
  const dismissed = skipped !== null && skipped > last;
  if (dismissed) return null;
  const remainingMs = last + graceMs - nowTick;
  if (remainingMs <= 0) return null;
  const remainingMin = Math.max(1, Math.ceil(remainingMs / 60_000));
  return (
    <div className="mb-3 rounded-2xl border border-amber-700/50 bg-amber-900/20 px-4 py-3 text-center">
      <p className="text-sm leading-7 text-amber-200">
        ⏸ بات تا {fa(remainingMin)} دقیقه دیگه ساکته (شما {relTime(grace!.lastOwnerSentAt!)} توی این چت پیام دادی).
        حالت «{MODE_LABELS[currentMode]}» بعد از این پنجره خودش دوباره فعال میشه.
      </p>
      <div className="mt-3 flex [justify-content:left]">
        <button type="button" onClick={onSkip} disabled={saving} className={`${btnCls} !bg-amber-600 !border-amber-600 text-white`}>▶ همین حالا بات رو فعال کن</button>
      </div>
    </div>
  );
}
