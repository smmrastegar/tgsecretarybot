import { describe, expect, it } from "vitest";
import { buildRuleForwardText, fillDestPlaceholder } from "../lib/rule-delivery";

describe("reader route header", () => {
  it("reads like the ticket requests the router already understands, with the new source and destination", () => {
    const { text } = buildRuleForwardText({ ruleName: "Reader", senderName: "Ali", body: "سلام، سرور قطع شده", showRulePrefix: false, formatAsOtp: false, chatTitle: "گروه",
      forwardHeader: "🎫 درخواست تیک جدید داریم\nاز @HamisheDarbot ← مقصد: {dest} · {time}" });
    const out = fillDestPlaceholder(text, "Bonak");
    expect(out).toContain("🎫 درخواست تیک جدید داریم");
    expect(out).toContain("از @HamisheDarbot ← مقصد: Bonak");
    expect(out).toContain("سلام، سرور قطع شده");
  });
});
