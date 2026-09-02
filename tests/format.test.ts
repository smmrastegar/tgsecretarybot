import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relTime, truncate } from "../lib/format";

describe("relTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("answers in Persian with Persian digits", () => {
    expect(relTime("2026-09-02T11:55:00Z")).toBe("۵ دقیقه پیش");
    expect(relTime("2026-09-02T07:00:00Z")).toBe("۵ ساعت پیش");
    expect(relTime("2026-08-30T12:00:00Z")).toBe("۳ روز پیش");
  });

  it("says 'just now' under a minute and for future timestamps", () => {
    expect(relTime("2026-09-02T11:59:30Z")).toBe("همین الان");
    expect(relTime("2026-09-02T12:30:00Z")).toBe("همین الان");
  });

  it("accepts Date objects", () => {
    expect(relTime(new Date("2026-09-02T11:00:00Z"))).toBe("۱ ساعت پیش");
  });

  it("never throws on bad input — returns the em-dash", () => {
    // Regression: this used to throw inside list rendering and take the
    // whole page down with it.
    expect(relTime(null)).toBe("—");
    expect(relTime(undefined)).toBe("—");
    expect(relTime("not a date")).toBe("—");
    expect(relTime({} as unknown as string)).toBe("—");
  });

  it("scales to months and years", () => {
    expect(relTime("2026-06-01T12:00:00Z")).toBe("۳ ماه پیش");
    expect(relTime("2024-06-01T12:00:00Z")).toBe("۲ سال پیش");
  });
});

describe("truncate", () => {
  it("leaves short strings alone and ellipsises long ones", () => {
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abcdefgh", 5)).toBe("abcd…");
  });
});
