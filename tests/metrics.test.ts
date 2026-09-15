import { describe, expect, it } from "vitest";
import { stabilityScore, tehranDayBounds, tehranToday } from "../lib/metrics";

describe("tehran day bounds", () => {
  it("maps a Tehran calendar day to a 24h UTC window starting at 20:30 the day before", () => {
    const { from, to } = tehranDayBounds("2026-09-14");
    expect(from.toISOString()).toBe("2026-09-13T20:30:00.000Z");
    expect(to.toISOString()).toBe("2026-09-14T20:30:00.000Z");
  });
  it("rolls the Tehran date at 20:30 UTC", () => {
    expect(tehranToday(new Date("2026-09-14T20:29:00Z"))).toBe("2026-09-14");
    expect(tehranToday(new Date("2026-09-14T20:31:00Z"))).toBe("2026-09-15");
  });
});

describe("stabilityScore", () => {
  it("is 100 on a clean day and never below 0", () => {
    expect(stabilityScore({ errors: 0, deploysFailed: 0, mediaRoutingErrors: 0 }, { ruleForwardErrors: 0 })).toBe(100);
    expect(stabilityScore({ errors: 500, deploysFailed: 3, mediaRoutingErrors: 50 }, { ruleForwardErrors: 50 })).toBe(10);
  });
  it("charges each failure class separately, capped", () => {
    expect(stabilityScore({ errors: 5, deploysFailed: 0, mediaRoutingErrors: 0 }, { ruleForwardErrors: 0 })).toBe(90);
    expect(stabilityScore({ errors: 0, deploysFailed: 1, mediaRoutingErrors: 0 }, { ruleForwardErrors: 0 })).toBe(80);
    expect(stabilityScore({ errors: 0, deploysFailed: 0, mediaRoutingErrors: 0 }, { ruleForwardErrors: 2 })).toBe(90);
  });
});
