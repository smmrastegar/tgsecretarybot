import { describe, expect, it } from "vitest";
import { richHtmlToClassic, richMarkdownToClassic } from "../lib/telegram-rich";

// The fallback is what a reader sees if sendRichMessage ever fails, so
// it must be valid classic-HTML: no block tags left, bold/italic kept,
// tables and lists still readable.

describe("richHtmlToClassic", () => {
  it("flattens headings, lists and tables", () => {
    const out = richHtmlToClassic(
      "<h3>گزارش</h3><ul><li>الف</li><li>ب</li></ul><table><tr><th>k</th><th>v</th></tr><tr><td>1</td><td>2</td></tr></table>",
    );
    expect(out).toContain("<b>گزارش</b>");
    expect(out).toContain("• الف");
    expect(out).toContain("k | v");
    expect(out).toContain("1 | 2");
    for (const tag of ["<h3", "<ul", "<li", "<table", "<tr", "<td", "<th"]) {
      expect(out).not.toContain(tag);
    }
  });
  it("keeps inline formatting and quotes, drops rich-only tags", () => {
    const out = richHtmlToClassic(
      '<blockquote expandable>نقل<cite>x</cite></blockquote><details><summary>بیشتر</summary><p>متن</p></details><tg-button type="url" url="https://t.me">b</tg-button><mark>m</mark>',
    );
    expect(out).toContain("<blockquote>نقل — x</blockquote>");
    expect(out).toContain("<b>بیشتر</b>");
    expect(out).toContain("متن");
    expect(out).not.toContain("tg-button");
    expect(out).toContain("<u>m</u>");
  });
  it("renders checkboxes", () => {
    const out = richHtmlToClassic(
      '<ul><li><input type="checkbox" checked>done</li><li><input type="checkbox">todo</li></ul>',
    );
    expect(out).toContain("☑ done");
    expect(out).toContain("☐ todo");
  });
});

describe("richMarkdownToClassic", () => {
  it("strips markdown and escapes html", () => {
    const out = richMarkdownToClassic("## عنوان\n\n- **مهم** <x>\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(out.startsWith("عنوان")).toBe(true);
    expect(out).toContain("• مهم &lt;x&gt;");
    expect(out).not.toContain("|---");
    expect(out).toContain("| 1 | 2 |");
  });
});
