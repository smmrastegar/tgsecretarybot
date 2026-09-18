import { describe, expect, it } from "vitest";
import { jaccard, rankSimilar, smsTokens, ACCEPT_SURE, BLOCK_SURE } from "../lib/sms-similarity";

const BANK_A = "بانک ملت: برداشت 1,250,000 ریال از حساب 4567 در 1405/06/20 ساعت 14:22. مانده: 8,300,000 ریال";
const BANK_B = "بانک ملت: برداشت 300,000 ریال از حساب 4567 در 1405/06/21 ساعت 09:10. مانده: 8,000,000 ریال";
const BANK_C = "بانک ملت: واریز 5,000,000 ریال به حساب 4567 در 1405/06/22 ساعت 11:00. مانده: 13,000,000 ریال";
const AD = "فروش ویژه آپارتمان ۸۰ متری در سعادت آباد، وام بانکی، تحویل فوری. املاک آریا. لغو11";
const AD2 = "آپارتمان ۹۵ متری در شهرک غرب، فروش فوری با وام بانکی. املاک پارس. لغو11";
const OTP = "کد ورود شما: 483920. این کد تا ۲ دقیقه معتبر است.";

describe("smsTokens", () => {
  it("masks numbers, urls and punctuation", () => {
    const t = smsTokens("کد 483920 در https://x.io/abc ، ساعت 14:22!");
    expect(t.has("numtoken")).toBe(true);
    expect(t.has("urltoken")).toBe(true);
    expect([...t].some((x) => /\d{3,}/.test(x))).toBe(false);
    expect(t.has("کد")).toBe(true);
  });
});

describe("jaccard / rankSimilar", () => {
  it("scores the same bank notice with different amounts as sure", () => {
    expect(jaccard(smsTokens(BANK_A), smsTokens(BANK_B))).toBeGreaterThanOrEqual(ACCEPT_SURE);
  });
  it("scores a related notice from the same sender as a candidate but not sure", () => {
    const s = jaccard(smsTokens(BANK_A), smsTokens(BANK_C));
    expect(s).toBeGreaterThan(0.2);
    expect(s).toBeLessThan(BLOCK_SURE);
  });
  it("keeps an OTP far from a real-estate ad", () => {
    expect(jaccard(smsTokens(OTP), smsTokens(AD))).toBeLessThan(0.1);
  });
  it("ranks the nearest examples first and applies the sender bonus", () => {
    const ranked = rankSimilar("بانک ملت: برداشت 99,000 ریال از حساب 4567 در 1405/07/01 ساعت 10:00. مانده: 1,000,000 ریال", "Bank Mellat", [
      { text: AD, sender: "Amlak" },
      { text: BANK_A, sender: "Bank Mellat" },
      { text: BANK_C, sender: "bank mellat" },
    ]);
    expect(ranked[0]?.example.text).toBe(BANK_A);
    expect(ranked[0]?.sameSender).toBe(true);
    expect(ranked.some((r) => r.example.text === AD)).toBe(false);
  });
  it("two real-estate ads from different agencies are candidates, not sure", () => {
    const s = jaccard(smsTokens(AD), smsTokens(AD2));
    expect(s).toBeGreaterThan(0.2);
    expect(s).toBeLessThan(BLOCK_SURE);
  });
});
