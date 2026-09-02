import { describe, expect, it } from "vitest";

// The rule "تیکت‌ها (هر مبدأ)" uses this exact match_pattern (stored in
// message_rules). When a pattern is set it DECIDES on its own — no
// classifier — so this is the whole contract for what gets forwarded to
// Aicodeasa. Change the pattern in the DB and here together.
const PATTERN = String.raw`^\s*[\u{1F3AB}\u{1F39F}\u{1F3F7}️]*\s*تیکت[ِ‌]?\s*(?:شماره\s*)?#?\s*[0-9۰-۹]+`;
const re = new RegExp(PATTERN, "u");

describe("ticket match_pattern", () => {
  it("accepts every ticket header shape seen in production", () => {
    for (const t of [
      "🎫 تیکت #5\n👤 ثبت‌کننده: مهدی رستگار\n🕐 2026-08-28 15:12\nتست",
      "🎫 تیکت #100\n👤 ثبت‌کننده: tester",
      "تیکتِ #45\nدستگاه: YAZDI",
      "تیکت شماره ۱۲\nبررسی شود",
      "🎫 تیکت ۹۹\n👤 ثبت‌کننده: x",
      "🎫 تیکت #14\n👤 ثبت‌کننده: Zahra Ayyubi\n🕐 2026-08-29 12:49\n\nوضعیت سیستم رو ارزیابی کن یه گزارش بهم بده",
    ]) {
      expect(re.test(t), t.split("\n")[0]).toBe(true);
    }
  });

  it("rejects people merely talking about tickets, and replies", () => {
    for (const t of [
      "سلام، یه تیکت جدید داریم لطفا بررسی کن",
      "بچه‌ها تیکت زدم براش",
      "↩️ پاسخ به تیکت #8\n\nرسید ✅",
      "پاسخ در تیکت #۷۱ ثبت شد (msg #307).",
      "✅ تیکت #6 — انجام شد",
    ]) {
      expect(re.test(t), t.split("\n")[0]).toBe(false);
    }
  });

  it("rejects our own forward header — the loop case", () => {
    expect(re.test("🎫 تیکت تازه\nاز LimooMe · MCP agent ← مقصد: Limoome")).toBe(false);
  });

  it("rejects status reports and agent notices", () => {
    for (const t of [
      "⚙️ پرفورمنس — Asiatec DB\n• Load: 6.24",
      "✅ AI DevOps agent connected — این تاپیک تنها جاییه که این توکن اجازه‌ی نوشتن داره.",
      "📊 پنل مانیتورینگ: http://192.168.200.52:8600",
    ]) {
      expect(re.test(t), t.split("\n")[0]).toBe(false);
    }
  });
});
