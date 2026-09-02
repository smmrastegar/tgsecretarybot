import { describe, expect, it } from "vitest";
import { hostMatches } from "../lib/db";

// The link-download relay decides which bot to hand a URL to by hostname.
// The match must be anchored: a suffix match would treat
// "notinstagram.com" as Instagram and relay attacker-chosen hosts.

describe("hostMatches", () => {
  it("matches the exact host and subdomains", () => {
    expect(hostMatches("instagram.com", "instagram.com")).toBe(true);
    expect(hostMatches("www.instagram.com", "instagram.com")).toBe(true);
    expect(hostMatches("open.spotify.com", "spotify.com")).toBe(true);
  });

  it("rejects look-alike hosts", () => {
    expect(hostMatches("notinstagram.com", "instagram.com")).toBe(false);
    expect(hostMatches("instagram.com.evil.io", "instagram.com")).toBe(false);
    expect(hostMatches("instagram.co", "instagram.com")).toBe(false);
  });
});
