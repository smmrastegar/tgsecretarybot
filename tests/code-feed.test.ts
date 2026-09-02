import { describe, expect, it } from "vitest";
import { extractCodes, hasCode, normalizeDigits } from "../lib/code-feed";

// Every case here is a shape that was actually seen in the SMS channel.
// The rules: a code is 4–8 digits near a code word, not part of a longer
// number, not a date, and not inside a URL.

describe("normalizeDigits", () => {
  it("maps Persian and Arabic-Indic digits to ASCII", () => {
    expect(normalizeDigits("۷۳۴۱۹۵")).toBe("734195");
    expect(normalizeDigits("٤٥٦")).toBe("456");
    expect(normalizeDigits("abc 12")).toBe("abc 12");
  });
});

describe("extractCodes", () => {
  it("finds a Persian OTP", () => {
    expect(extractCodes("کد ورود شما: 481902")).toEqual(["481902"]);
  });

  it("finds a Persian OTP written in Persian digits", () => {
    expect(extractCodes("رمز یکبار مصرف: ۷۳۴۱۹۵")).toEqual(["734195"]);
  });

  it("finds an English code that ends a sentence", () => {
    // Regression: a trailing period used to be read as a date separator
    // and the code was silently dropped.
    expect(extractCodes("Your verification code is 20458. Do not share it.")).toEqual(["20458"]);
    expect(extractCodes("OTP is 9931.")).toEqual(["9931"]);
  });

  it("rejects dates even next to a code word", () => {
    expect(extractCodes("کد تاریخ 1405/05/30")).toEqual([]);
    expect(extractCodes("your code: 2026-08-21")).toEqual([]);
  });

  it("rejects a bare year", () => {
    expect(extractCodes("کد سال 2026")).toEqual([]);
    expect(extractCodes("رمز 1405")).toEqual([]);
  });

  it("ignores digits that are only inside a URL", () => {
    expect(extractCodes("کد: https://example.com/otp/30625419")).toEqual([]);
  });

  it("ignores marketing SMS with no code word near the digits", () => {
    expect(extractCodes("۶۰٪ تخفیف ویژه پاییز! همین حالا خرید کن\nلغو11")).toEqual([]);
    expect(extractCodes("ش پیگیری: 59153082 — سفارش شما ثبت شد")).toEqual([]);
  });

  it("does not match the code word inside a longer word", () => {
    // «کد» inside «بانکداری» must not count as a keyword.
    expect(extractCodes("بانکداری اینترنتی 123456")).toEqual([]);
  });

  it("does not take an amount as a code", () => {
    // 704,000,000 is comma-separated 3-digit groups; none is 4–8 digits.
    const codes = extractCodes("رمز پویا 6612 برای مبلغ 704,000,000 ریال");
    expect(codes).toContain("6612");
    expect(codes).not.toContain("704");
    expect(codes).not.toContain("000");
  });

  it("dedupes a code repeated in the message", () => {
    expect(extractCodes("code 977487 — call.com #977487")).toEqual(["977487"]);
  });

  it("returns nothing for empty input", () => {
    expect(extractCodes("")).toEqual([]);
    expect(hasCode("")).toBe(false);
  });
});
