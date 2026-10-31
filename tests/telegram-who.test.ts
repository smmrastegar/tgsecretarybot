import { describe, expect, it } from "vitest";
import { parseTelegramWho } from "../lib/music-scope";

describe("parseTelegramWho", () => {
  it("reads numeric ids and usernames in the usual spellings", () => {
    expect(parseTelegramWho("123456789")).toEqual({ tgUserId: 123456789, username: null });
    expect(parseTelegramWho(" @Sara_Music ")).toEqual({ tgUserId: null, username: "sara_music" });
    expect(parseTelegramWho("https://t.me/Sara_Music")).toEqual({ tgUserId: null, username: "sara_music" });
    expect(parseTelegramWho("sara_music")).toEqual({ tgUserId: null, username: "sara_music" });
  });
  it("rejects anything else", () => {
    expect(parseTelegramWho("")).toBeNull();
    expect(parseTelegramWho("12")).toBeNull();
    expect(parseTelegramWho("a b")).toBeNull();
    expect(parseTelegramWho("@ab")).toBeNull();
  });
});
