import { describe, expect, it } from "vitest";
import { mentions, parseTitle, stripFeat, tidyTitle } from "@/lib/music-clean";

const first = (t: string) => parseTitle(t).readings[0]!;
const has = (t: string, artist: string | null, title: string) => parseTitle(t).readings.some((r) => r.artist === artist && r.title === title);

describe("tidyTitle", () => {
  it("drops numbering, extensions, hashtags and noise", () => {
    expect(tidyTitle("12. Jâné Màryàm.mp3")).toBe("Jâné Màryàm");
    expect(tidyTitle("Sepehr Boni - Donya Chips Remix #rap #new #2023")).toBe("Sepehr Boni - Donya Chips Remix");
    expect(tidyTitle("Marjan - Khooneye Ma (Official Audio)")).toBe("Marjan - Khooneye Ma");
  });
});

describe("parseTitle", () => {
  it("reads 'Artist - Title' and the reverse", () => {
    expect(has("Homayoun Shajarian - Aghooshe Khali", "Homayoun Shajarian", "Aghooshe Khali")).toBe(true);
    expect(has("Homayoun Shajarian - Aghooshe Khali", "Aghooshe Khali", "Homayoun Shajarian")).toBe(true);
  });
  it("prefers the Latin script and drops the Persian twin", () => {
    expect(first("Hermās | هرماس")).toMatchObject({ artist: null, title: "Hermās" });
    expect(parseTitle("Delara - Mehrab _ دل‌آرا - محراب _ Vajd Records").readings[0]).toMatchObject({ artist: "Delara", title: "Mehrab" });
    expect(has("Delara - Mehrab _ دل‌آرا - محراب _ Vajd Records", "Mehrab", "Delara")).toBe(true);
  });
  it("splits artist - title - version", () => {
    expect(has("Mehrad Hidden X Kaviano - Sargardoon - Meead REMIX", "Mehrad Hidden X Kaviano", "Sargardoon")).toBe(true);
    expect(parseTitle("Mehrad Hidden X Kaviano - Sargardoon - Meead REMIX").derived).toBe(true);
  });
  it("collects feat names", () => {
    expect(parseTitle("Kābin Feat. Hadi Hadadi - Daricheh").feat).toContain("Hadi Hadadi");
    expect(stripFeat("Zibaye Man (feat. Golsa)")).toEqual({ names: ["Golsa"], rest: "Zibaye Man" });
  });
  it("flags covers and podcasts", () => {
    expect(parseTitle("Oono Nadidi - Kiosk (Cover By Nima Ahmadieh)").derived).toBe(true);
    expect(parseTitle("پادکست قاب.نت اپیزود سوم").derived).toBe(true);
    expect(parseTitle("Balzan - Parandeye Abi").derived).toBe(false);
  });
});

describe("mentions", () => {
  it("finds a whole name inside a longer text", () => {
    expect(mentions("Sarnevesht - homayoun shajarian (Ft Anoushirvan Rohani)", "Homayoun Shajarian")).toBe(true);
    expect(mentions("Sarnevesht - homayoun", "Homayoun Shajarian")).toBe(false);
  });
});
