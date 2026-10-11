import { describe, expect, it } from "vitest";
import { trackKey } from "@/lib/music-artists";

describe("trackKey", () => {
  it("treats a single and its album copy as the same song", () => {
    expect(trackKey("Zende Bad (feat. Someone)")).toBe(trackKey("Zende Bad"));
    expect(trackKey("Zende  Bad!")).toBe(trackKey("zende bad"));
  });
  it("keeps other versions apart", () => {
    expect(trackKey("Zende Bad")).not.toBe(trackKey("Zende Bad - Remix"));
    expect(trackKey("Zende Bad")).not.toBe(trackKey("Zende Bad (Live)"));
  });
  it("copes with non-latin titles", () => {
    expect(trackKey("بی وفا")).toBe(trackKey("بی  وفا "));
    expect(trackKey("بی وفا")).not.toBe("");
  });
});
