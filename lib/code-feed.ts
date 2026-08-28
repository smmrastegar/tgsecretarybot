// Extraction of verification codes from SMS-style channel posts, plus
// the shared shape of a token-gated code feed.
//
// The channels these feeds read carry a lot of marketing SMS alongside
// the real OTPs ("۶۰٪تخفیف …", "لغو11", invoice amounts like
// "704,000,000 ریال"). Matching bare digits would surface all of that,
// so a message only counts as carrying a code when a code-ish KEYWORD
// appears near a short digit run.

const CODE_WORDS = [
  "code", "otp", "pin", "verification", "verify", "password", "passcode",
  "کد", "رمز", "تایید", "تأیید", "احراز", "پویا", "یکبار", "یک‌بار",
];

// Persian/Arabic-Indic digits → ASCII so one regex handles every form.
export function normalizeDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

// A code is 4–8 digits that is NOT part of a longer number (phone
// numbers, invoice ids, prices) — hence the digit-boundary guards.
// A code is 4–8 digits that is NOT part of a longer number (phone
// numbers, invoice ids, prices) — hence the digit-boundary guards.
const CODE_RE = /(?<![\d۰-۹٠-٩])(\d{4,8})(?![\d۰-۹٠-٩])/g;

// Keyword hits must be whole words. Persian has no spaces inside many
// compounds, and a naive substring test matched "کد" inside "بانکداری",
// which turned a bank login notice into a "code" message.
const KEYWORD_RE = new RegExp(
  `(?<!\\p{L})(${CODE_WORDS.join("|")})(?!\\p{L})`,
  "giu",
);

function hasKeyword(s: string): boolean {
  KEYWORD_RE.lastIndex = 0;
  return KEYWORD_RE.test(s);
}

// URLs carry long digit runs that look like codes (".../otp/30625419").
// Blank them out before scanning rather than trying to exclude them later.
function stripUrls(s: string): string {
  return s.replace(/https?:\/\/\S+|\b[\w-]+\.(ir|com|net|org|co)\/\S*/gi, " ");
}

// 1405/05/30 or 2026-08-21 — a date, never a verification code.
function looksLikeDate(text: string, at: number, len: number): boolean {
  const before = text.slice(Math.max(0, at - 1), at);
  const after = text.slice(at + len, at + len + 1);
  return /[/\-.]/.test(before) || /[/\-.]/.test(after);
}

export function extractCodes(raw: string): string[] {
  if (!raw) return [];
  const text = stripUrls(normalizeDigits(raw));
  if (!hasKeyword(text)) return [];
  const out: string[] = [];
  for (const m of text.matchAll(CODE_RE)) {
    const code = m[1]!;
    const at = m.index ?? 0;
    if (looksLikeDate(text, at, code.length)) continue;
    // A 4-digit Gregorian or Persian year is a date, not a code.
    if (/^(1[34]\d{2}|19\d{2}|20\d{2})$/.test(code)) continue;
    // Keep only digits sitting near a code word, so a marketing SMS that
    // merely mentions "کد" elsewhere can't donate its price or year.
    const around = text.slice(Math.max(0, at - 45), at + code.length + 12);
    if (!hasKeyword(around)) continue;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

export function hasCode(text: string): boolean {
  return extractCodes(text).length > 0;
}

export type FeedFormat = "json" | "text" | "codes" | "html";

export function renderFeed(
  format: FeedFormat,
  items: Array<{ at: string; text: string; codes: string[] }>,
): { body: string; contentType: string } {
  if (format === "codes") {
    return {
      body: items.flatMap((i) => i.codes).join("\n"),
      contentType: "text/plain; charset=utf-8",
    };
  }
  if (format === "text") {
    return {
      body: items
        .map((i) => `${i.at}  ${i.codes.join(", ")}\n${i.text}`)
        .join("\n\n"),
      contentType: "text/plain; charset=utf-8",
    };
  }
  if (format === "html") {
    return {
      body: renderFeedHtml(items),
      contentType: "text/html; charset=utf-8",
    };
  }
  return {
    body: JSON.stringify({ count: items.length, items }, null, 2),
    contentType: "application/json; charset=utf-8",
  };
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

// A self-contained page: no external CSS, fonts or scripts, because the
// feed is served with a strict no-store policy to whoever holds the
// token and should not reach out to third parties while showing a
// one-time code. Times are rendered client-side in the viewer's own
// locale — the server has no idea what timezone they're in.
function renderFeedHtml(
  items: Array<{ at: string; text: string; codes: string[] }>,
): string {
  const cards = items
    .map((i) => {
      const codes = i.codes
        .map(
          (c) =>
            `<button class="code" data-copy="${esc(c)}" title="برای کپی کلیک کن">` +
            `<span class="v">${esc(c)}</span><span class="hint">کپی</span></button>`,
        )
        .join("");
      return (
        `<article class="card">` +
        `<div class="codes">${codes}</div>` +
        `<time datetime="${esc(i.at)}" data-at="${esc(i.at)}">${esc(i.at)}</time>` +
        `<p class="body">${esc(i.text)}</p>` +
        `</article>`
      );
    })
    .join("");

  const empty =
    `<div class="empty"><div class="big">—</div>` +
    `<p>در این بازه پیام کدداری نیامده.</p></div>`;

  return `<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>کدهای اخیر</title>
<style>
  :root{--bg:#0b0d10;--card:#14181d;--card2:#1b2027;--line:#252c35;--fg:#e8edf3;--dim:#8b97a6;--ok:#34d399;--accent:#5b8cff}
  @media (prefers-color-scheme:light){
    :root{--bg:#f5f7fa;--card:#fff;--card2:#eef2f7;--line:#dde3ea;--fg:#12171d;--dim:#5d6b7a}
  }
  *{box-sizing:border-box}
  body{margin:0;padding:20px 16px 48px;background:var(--bg);color:var(--fg);
    font-family:system-ui,-apple-system,"Segoe UI",Vazirmatn,Tahoma,sans-serif;
    -webkit-text-size-adjust:100%}
  .wrap{max-width:640px;margin:0 auto}
  header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:18px}
  h1{font-size:17px;margin:0;font-weight:600}
  .count{font-size:12px;color:var(--dim)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;
    padding:14px;margin-bottom:12px}
  .codes{display:flex;flex-wrap:wrap;gap:8px}
  .code{display:inline-flex;align-items:center;gap:10px;cursor:pointer;
    background:var(--card2);border:1px solid var(--line);border-radius:10px;
    padding:10px 14px;color:inherit;font:inherit;transition:border-color .15s,background .15s}
  .code:hover{border-color:var(--accent)}
  .code .v{font:600 22px/1 ui-monospace,SFMono-Regular,Menlo,monospace;
    letter-spacing:.14em;direction:ltr}
  .code .hint{font-size:11px;color:var(--dim)}
  .code.done{border-color:var(--ok)}
  .code.done .hint{color:var(--ok)}
  time{display:block;margin-top:10px;font-size:12px;color:var(--dim);direction:ltr;text-align:start}
  .body{margin:8px 0 0;font-size:13px;line-height:1.75;color:var(--dim);
    white-space:pre-wrap;word-break:break-word}
  .empty{text-align:center;color:var(--dim);padding:56px 0}
  .empty .big{font-size:34px;opacity:.5}
  footer{margin-top:22px;text-align:center;font-size:11px;color:var(--dim)}
</style>
<div class="wrap">
  <header><h1>کدهای اخیر</h1><span class="count">${items.length} پیام</span></header>
  ${items.length ? cards : empty}
  <footer>این صفحه ذخیره نمی‌شود؛ برای دیدن کدِ تازه دوباره بارگذاری کن.</footer>
</div>
<script>
(function(){
  // Absolute timestamps are ambiguous to read; show both the local
  // clock time and how long ago it was.
  function ago(ms){
    var s=Math.max(0,Math.round(ms/1000));
    if(s<60) return s+" ثانیه پیش";
    var m=Math.round(s/60);
    if(m<60) return m+" دقیقه پیش";
    return Math.round(m/60)+" ساعت پیش";
  }
  document.querySelectorAll("time[data-at]").forEach(function(t){
    var d=new Date(t.getAttribute("data-at"));
    if(isNaN(d)) return;
    t.textContent=d.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit",second:"2-digit"})
      +" · "+ago(Date.now()-d.getTime());
  });
  document.querySelectorAll(".code").forEach(function(b){
    b.addEventListener("click",function(){
      var v=b.getAttribute("data-copy"),h=b.querySelector(".hint");
      function ok(){b.classList.add("done");h.textContent="کپی شد ✓";
        setTimeout(function(){b.classList.remove("done");h.textContent="کپی";},1600);}
      if(navigator.clipboard&&window.isSecureContext){
        navigator.clipboard.writeText(v).then(ok,function(){});
        return;
      }
      var ta=document.createElement("textarea");
      ta.value=v;ta.style.position="fixed";ta.style.opacity="0";
      document.body.appendChild(ta);ta.select();
      try{document.execCommand("copy");ok();}catch(e){}
      document.body.removeChild(ta);
    });
  });
})();
</script>
</html>`;
}
