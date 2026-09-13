import { describe, expect, it } from "vitest";
import {
  clampTtl,
  EPHEMERAL_DEFAULT_TTL,
  EPHEMERAL_MAX_TTL,
  EPHEMERAL_MIN_TTL,
} from "../lib/ephemeral";

// Telegram refuses to delete a message older than 48h; a TTL past the
// cap would leave an "ephemeral" message up forever, which is worse
// than refusing. The clamp is the whole guarantee.
describe("clampTtl", () => {
  it("defaults when absent or garbage", () => {
    expect(clampTtl(undefined)).toBe(EPHEMERAL_DEFAULT_TTL);
    expect(clampTtl("abc")).toBe(EPHEMERAL_DEFAULT_TTL);
    expect(clampTtl(null)).toBe(EPHEMERAL_DEFAULT_TTL);
  });
  it("clamps to the Telegram-safe window", () => {
    expect(clampTtl(0)).toBe(EPHEMERAL_MIN_TTL);
    expect(clampTtl(-5)).toBe(EPHEMERAL_MIN_TTL);
    expect(clampTtl(10 * 24 * 3600)).toBe(EPHEMERAL_MAX_TTL);
    expect(EPHEMERAL_MAX_TTL).toBeLessThan(48 * 3600);
  });
  it("rounds and accepts strings", () => {
    expect(clampTtl("90")).toBe(90);
    expect(clampTtl(59.6)).toBe(60);
  });
});
