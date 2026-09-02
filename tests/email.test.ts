import { describe, expect, it } from "vitest";
import { emailThreadKey, parseInboundEmail } from "../lib/email";

describe("parseInboundEmail", () => {
  it("reads a Resend-style inbound payload", () => {
    const e = parseInboundEmail({
      type: "email.received",
      data: {
        email_id: "abc-123",
        from: "Ali <ali@example.com>",
        to: ["admin@rateklend.ir"],
        subject: "Re: تست",
        text: "hello",
      },
    });
    expect(e.emailId).toBe("abc-123");
    expect(e.fromName).toBe("Ali");
    expect(e.fromEmail).toBe("ali@example.com");
    expect(e.toEmails).toBe("admin@rateklend.ir");
    expect(e.subject).toBe("Re: تست");
    expect(e.text).toBe("hello");
  });

  it("accepts a bare address and object-form senders", () => {
    expect(parseInboundEmail({ from: "x@y.z" }).fromEmail).toBe("x@y.z");
    const o = parseInboundEmail({ from: { email: "a@b.c", name: "A" } });
    expect(o.fromEmail).toBe("a@b.c");
    expect(o.fromName).toBe("A");
  });

  it("yields all-null fields for a payload that carries only an id", () => {
    // This is the shape of Resend's dashboard test event. The webhook must
    // treat it as empty rather than post a blank card.
    const e = parseInboundEmail({ type: "email.delivered", data: { email_id: "fixed-id" } });
    expect(e.emailId).toBe("fixed-id");
    expect(e.fromEmail).toBeNull();
    expect(e.subject).toBeNull();
    expect(e.text).toBeNull();
    expect(e.html).toBeNull();
  });

  it("does not crash on garbage", () => {
    expect(parseInboundEmail(null).emailId).toBeNull();
    expect(parseInboundEmail("str").emailId).toBeNull();
    expect(parseInboundEmail({ data: 5 }).emailId).toBeNull();
  });
});

describe("emailThreadKey", () => {
  it("strips reply/forward prefixes in both languages and normalises", () => {
    expect(emailThreadKey("Re: Hello")).toBe("hello");
    expect(emailThreadKey("FWD: Hello")).toBe("hello");
    expect(emailThreadKey("پاسخ: سلام")).toBe("سلام");
    expect(emailThreadKey(null)).toBe("");
  });
});
