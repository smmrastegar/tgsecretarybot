import { describe, expect, it } from "vitest";
import {
  anchorsPresent,
  findPhrase,
  isBareFirstNameAlias,
  nameCollision,
  phrasePresent,
  rejectedPhraseHit,
  selfNegatingReason,
  tokenize,
} from "../lib/watchlist-guards";

// Fixtures are the real false positives the operator flagged with
// 🚩 گزارش خطا in the notes inbox (note_watch_matches, Aug–Sep 2026).
const ARMAN = { concept: "آرمان گرشاسبی", aliases: ["آرمان", "گرشاسبی", "Arman Garshasbi", "Arman"] };
const AMIR = { concept: "امیر بال افشان", aliases: ["ماخولا", "بالزن", "امیر بال", "Amir Bal", "امیربال", "بال افشان"] };

describe("contiguous phrase matching", () => {
  it("requires alias tokens to be adjacent, not scattered", () => {
    expect(phrasePresent("امیر بال", "امیرعبدالرحیمی امروز با بال هواپیما رفت")).toBe(false);
    expect(phrasePresent("امیر بال", "کنسرت امیر بال فردا")).toBe(true);
    expect(phrasePresent("امیر بال", "کنسرت امیر  بال! فردا")).toBe(true);
  });
  it("does not match a first name inside a compound name", () => {
    expect(phrasePresent("امیر", "امیرحسین میرزائی پیام داد")).toBe(false);
    expect(phrasePresent("امیر بال", "امیرعبدالرحیمی")).toBe(false);
  });
  it("does not fuzz short words or fuzzy-match inside compound tokens", () => {
    expect(phrasePresent("بالزن", "اینا همه بالان الان")).toBe(false);
    expect(phrasePresent("امیربال", "بیشترین شخصی امیرعبدالرحیمی 85mb")).toBe(false);
    expect(phrasePresent("امیربال", "شهرزاد امیرشاه کرمی")).toBe(false);
    expect(phrasePresent("امیربال", "امیربالافشان کنسرت داره")).toBe(true);
  });
  it("tolerates a typo in a long token and ZWNJ compounds", () => {
    expect(phrasePresent("گرشاسبی", "گرشاسپی‌جون اومد")).toBe(true);
    expect(findPhrase("آرمان گرشاسبی", tokenize("آلبوم جدید آرمان گرشاسپی منتشر شد"))).toBe(2);
  });
  it("reports which anchors are present", () => {
    const a = anchorsPresent({ message: "آلبوم جدید Arman Garshasbi", ...ARMAN });
    expect(a.concept).toBe(false);
    expect(a.aliases).toEqual(["Arman Garshasbi", "Arman"]);
  });
});

describe("nameCollision — first name + another surname is someone else", () => {
  it("flags the reported false positives", () => {
    for (const msg of [
      "🎙 آرمان مهدی زاده آهنگ جدید داد",
      "آرمان درویش کنسرت داره",
      "آرمان منورصادق در جشنواره موسیقی",
    ]) {
      expect(nameCollision({ message: msg, ...ARMAN }), msg).not.toBeNull();
    }
  });
  it("does not flag vocatives, verbs or the real name", () => {
    for (const msg of ["آرمان جان بیا", "آرمان زنگ زد", "آرمان گرشاسبی کنسرت داره", "آلبوم آرمان گرشاسپی"]) {
      expect(nameCollision({ message: msg, ...ARMAN }), msg).toBeNull();
    }
  });
  it("ignores single-word concepts", () => {
    expect(nameCollision({ message: "ماخولا رضایی", concept: "ماخولا", aliases: [] })).toBeNull();
  });
});

describe("rejectedPhraseHit — operator feedback vetoes repeats", () => {
  const rejected = ["امیرعبدالرحیمی", "آرمان مهدی زاده", "آرمان منورصادق", "آرمان"];
  it("vetoes a message that repeats a rejected name", () => {
    expect(
      rejectedPhraseHit({ message: "گزارش روزانه: امیرعبدالرحیمی ۳ تیکت بست", concept: AMIR.concept, aliases: AMIR.aliases, rejectedQuotes: rejected }),
    ).toBe("امیرعبدالرحیمی");
    expect(
      rejectedPhraseHit({ message: "آرمان مهدی‌زاده تک‌آهنگ جدید", concept: ARMAN.concept, aliases: ARMAN.aliases, rejectedQuotes: rejected }),
    ).toBe("آرمان مهدی زاده");
  });
  it("never vetoes when the full concept is present", () => {
    expect(
      rejectedPhraseHit({ message: "امیرعبدالرحیمی و امیر بال افشان در کنسرت", concept: AMIR.concept, aliases: AMIR.aliases, rejectedQuotes: rejected }),
    ).toBeNull();
  });
  it("ignores a bare short rejected quote (handled by the bare-alias rule)", () => {
    expect(rejectedPhraseHit({ message: "آرمان کنسرت داره", concept: ARMAN.concept, aliases: ARMAN.aliases, rejectedQuotes: ["آرمان"] })).toBeNull();
  });
});

describe("selfNegatingReason", () => {
  it("catches the LLM contradicting itself", () => {
    for (const r of [
      'نام "امیر" در پیام وجود دارد اما به شخص دیگری اشاره دارد.',
      'نام "امیرعبدالرحیمی" بخشی از نام "امیر بال افشان" را دارد اما یک شخص متفاوت است',
      'نام "امیرعبدالرحیمی" شبیه به نام "امیر بال" است اما به دلیل شباهت صرف، تطابق قطعی نیست',
    ]) {
      expect(selfNegatingReason(r), r).toBe(true);
    }
  });
  it("leaves real reasons alone", () => {
    expect(selfNegatingReason("پیام حاوی نام کامل هنرمند است.")).toBe(false);
    expect(selfNegatingReason("پیام به طور واضح به کنسرت امیر بال افشان اشاره دارد.")).toBe(false);
  });
});

describe("isBareFirstNameAlias", () => {
  it("identifies a lone first-name alias", () => {
    expect(isBareFirstNameAlias("آرمان", ARMAN.concept)).toBe(true);
    expect(isBareFirstNameAlias("Arman", "Arman Garshasbi")).toBe(true);
    expect(isBareFirstNameAlias("گرشاسبی", ARMAN.concept)).toBe(false);
    expect(isBareFirstNameAlias("امیر بال", AMIR.concept)).toBe(false);
    expect(isBareFirstNameAlias(null, AMIR.concept)).toBe(false);
  });
});
