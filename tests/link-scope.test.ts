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
