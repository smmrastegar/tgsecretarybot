import { describe, expect, it } from "vitest";
import { accountCodes } from "../components/music/app/SourceMarks";

describe("accountCodes", () => {
  it("works codes out by itself", () => {
    const m = accountCodes([{ id: 1, name: "Mohammad Mahdi Rastegar" }, { id: 2, name: "Sara" }]);
    expect(m.get(1)).toBe("MMR");
    expect(m.get(2)).toBe("SAR");
  });
  it("a code typed by the owner wins, and automatic ones steer clear of it", () => {
    const m = accountCodes([{ id: 1, name: "Sara" }, { id: 2, name: "Saeed", code: "SAR" }]);
    expect(m.get(2)).toBe("SAR");
    expect(m.get(1)).not.toBe("SAR");
  });
});
