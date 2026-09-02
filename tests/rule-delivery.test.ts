import { describe, expect, it } from "vitest";
import {
  buildRuleForwardText,
  fillDestPlaceholder,
  HEADER_PLACEHOLDERS,
} from "../lib/rule-delivery";

describe("buildRuleForwardText", () => {
  it("renders header, rule prefix and body in plain mode", () => {
    const r = buildRuleForwardText({
      ruleName: "تیکت‌ها",
      senderName: "Asainternet",
      body: "متن پیام",
      showRulePrefix: true,
      formatAsOtp: false,
      forwardHeader: "🎫 از {sender} ← {dest}",
      chatTitle: null,
    });
    expect(r.parseMode).toBeUndefined();
    expect(r.text.startsWith("🎫 از Asainternet ← {dest}")).toBe(true);
    expect(r.text).toContain("[rule: تیکت‌ها] · از Asainternet");
    expect(r.text.endsWith("متن پیام")).toBe(true);
  });

  it("leaves {dest} for the per-recipient pass and fills it later", () => {
    const r = buildRuleForwardText({
      ruleName: "x", senderName: "s", body: "b",
      showRulePrefix: false, formatAsOtp: false,
      forwardHeader: "مقصد: {dest}",
    });
    expect(r.text).toContain("{dest}");
    expect(fillDestPlaceholder(r.text, "SingBox(Support)")).toContain("مقصد: SingBox(Support)");
    expect(fillDestPlaceholder(r.text, null)).toContain("مقصد: ");
  });

  it("in OTP mode returns empty text when no code was extracted", () => {
    // The caller skips the forward on empty text; the old behaviour was
    // to wrap the raw body in a 🔑 block and confuse the recipient.
    const r = buildRuleForwardText({
      ruleName: "x", senderName: "s", body: "کد بده",
      showRulePrefix: true, formatAsOtp: true, otpCode: null,
    });
    expect(r.text).toBe("");
  });

  it("in OTP mode renders a tap-to-copy code block with HTML parse mode", () => {
    const r = buildRuleForwardText({
      ruleName: "بانک", senderName: "s", body: "ignored",
      showRulePrefix: false, formatAsOtp: true, otpCode: "123456",
      forwardHeader: "<b>",
    });
    expect(r.parseMode).toBe("HTML");
    expect(r.text).toContain("<code>123456</code>");
    // the header is escaped, not injected
    expect(r.text).toContain("&lt;b&gt;");
  });

  it("documents every placeholder the renderer understands", () => {
    const tokens = HEADER_PLACEHOLDERS.map((p) => p.token).sort();
    expect(tokens).toEqual(["{chat}", "{date}", "{dest}", "{rule}", "{sender}", "{time}"]);
  });
});
