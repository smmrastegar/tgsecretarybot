import { describe, expect, it } from "vitest";
import { bool, date, dateOrNull, num, numOrNull, str, strOrNull } from "../lib/db/row";

// The accessors exist to absorb driver differences at the DB edge, so
// each is checked against the shapes the three drivers actually return.

describe("row accessors", () => {
  it("str / strOrNull", () => {
    expect(str({ a: "x" }, "a")).toBe("x");
    expect(str({ a: null }, "a")).toBe("");
    expect(str({ a: 5 }, "a")).toBe("5");
    expect(strOrNull({ a: "" }, "a")).toBeNull();
    expect(strOrNull({}, "a")).toBeNull();
  });

  it("num / numOrNull coerce bigint-as-string and reject garbage", () => {
    expect(num({ a: "42" }, "a")).toBe(42);
    expect(num({ a: 7 }, "a")).toBe(7);
    expect(num({ a: "abc" }, "a")).toBe(0);
    expect(num({ a: null }, "a", -1)).toBe(-1);
    expect(numOrNull({ a: "9007199254740993" }, "a")).toBe(9007199254740992);
    expect(numOrNull({ a: undefined }, "a")).toBeNull();
    expect(numOrNull({ a: "x" }, "a")).toBeNull();
  });

  it("bool accepts postgres, mysql and text forms", () => {
    for (const v of [true, 1, "1", "t", "true", "TRUE"]) expect(bool({ a: v }, "a")).toBe(true);
    for (const v of [false, 0, "0", "f", "false"]) expect(bool({ a: v }, "a")).toBe(false);
    expect(bool({ a: null }, "a")).toBe(false);
    expect(bool({ a: null }, "a", true)).toBe(true);
    expect(bool({ a: "maybe" }, "a", true)).toBe(true);
  });

  it("date / dateOrNull accept Date, ISO string and epoch; reject junk", () => {
    const d = new Date("2026-09-02T10:00:00Z");
    expect(date({ a: d }, "a")).toBe(d);
    expect(date({ a: "2026-09-02T10:00:00Z" }, "a").toISOString()).toBe(d.toISOString());
    expect(dateOrNull({ a: d.getTime() }, "a")?.toISOString()).toBe(d.toISOString());
    expect(dateOrNull({ a: null }, "a")).toBeNull();
    expect(dateOrNull({ a: "nope" }, "a")).toBeNull();
    expect(Number.isNaN(date({ a: "nope" }, "a").getTime())).toBe(true);
  });
});
