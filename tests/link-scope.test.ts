import { describe, expect, it } from "vitest";
import { parseScope } from "@/lib/music-token";

describe("parseScope", () => {
  it("normalises ids and mode, empty means no scope", () => {
    expect(parseScope('{"ids":[2,"3",3,-1,"x"],"mode":"all"}')).toEqual({ ids: [2, 3], mode: "all" });
    expect(parseScope({ ids: [1] })).toEqual({ ids: [1], mode: "any" });
    expect(parseScope('{"ids":[]}')).toBeNull();
    expect(parseScope("")).toBeNull();
    expect(parseScope("not json")).toBeNull();
  });
});

import { matchesAccounts } from "@/lib/music-scope";
describe("matchesAccounts", () => {
  it("treats songs without an account as the direct pseudo-account 0", () => {
    expect(matchesAccounts([], [3], "any")).toBe(false);
    expect(matchesAccounts([], [0, 3], "any")).toBe(true);
    expect(matchesAccounts(undefined, [0], "all")).toBe(true);
    expect(matchesAccounts([1, 3], [1, 3], "all")).toBe(true);
    expect(matchesAccounts([1], [1, 3], "all")).toBe(false);
    expect(matchesAccounts([], [], "any")).toBe(true);
  });
});
