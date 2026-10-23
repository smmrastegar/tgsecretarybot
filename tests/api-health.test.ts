import { describe, expect, it } from "vitest";
import { outcomeOf } from "../lib/api-health";

describe("outcomeOf", () => {
  it("counts successes, limits and real failures, and ignores the caller's own 4xx", () => {
    expect(outcomeOf(200)).toBe("ok");
    expect(outcomeOf(206)).toBe("ok");
    expect(outcomeOf(429)).toBe("limited");
    expect(outcomeOf(401)).toBe("error");
    expect(outcomeOf(403)).toBe("error");
    expect(outcomeOf(503)).toBe("error");
    expect(outcomeOf(404)).toBeNull();
    expect(outcomeOf(400)).toBeNull();
  });
});
