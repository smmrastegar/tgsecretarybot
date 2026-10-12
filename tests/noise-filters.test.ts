import { describe, expect, it } from "vitest";
import { isAutomatedNoise, isRepeatAlert, titleKey } from "@/lib/noise-filters";

describe("isAutomatedNoise", () => {
  it("drops login codes and security notices", () => {
    for (const t of ["کد ورود به بلو", "کد دسترسی محرمانه MYGOV", "تغییر تنظیمات احراز هویت چند عاملی", "هشدار ورود به سامانه بانکی", "Your verification code"]) expect(isAutomatedNoise({ title: t })).toBe(true);
  });
  it("drops infra alarms by their source text", () => {
    expect(isAutomatedNoise({ title: "بررسی دیتابیس", sourceText: "🔴 CrashLoopBackOff: database/mongodb-8" })).toBe(true);
  });
  it("keeps real tasks", () => {
    for (const t of ["تماس با علی فردا", "ارسال گزارش ماهانه", "جلسه ساعت ۱۰ با تیم"]) expect(isAutomatedNoise({ title: t, sourceText: "فردا ساعت ۱۰ جلسه داریم" })).toBe(false);
  });
});

describe("titleKey", () => {
  it("matches the same task written with different digits/spacing", () => {
    expect(titleKey("تماس با 09183470027")).toBe(titleKey("تماس با   09123456789 !"));
    expect(titleKey("Call Ali")).not.toBe(titleKey("Call Reza"));
  });
});

describe("isRepeatAlert", () => {
  it("lets the first through and holds identical repeats for 3 hours", () => {
    const t0 = 1_700_000_000_000;
    expect(isRepeatAlert(7, "🔴 CrashLoopBackOff db-8 at 12:01", t0)).toBe(false);
    expect(isRepeatAlert(7, "🔴 CrashLoopBackOff db-8 at 12:07", t0 + 6 * 60_000)).toBe(true);
    expect(isRepeatAlert(8, "🔴 CrashLoopBackOff db-8 at 12:07", t0 + 6 * 60_000)).toBe(false);
    expect(isRepeatAlert(7, "🔴 CrashLoopBackOff db-8 at 15:30", t0 + 4 * 3_600_000)).toBe(false);
  });
});
