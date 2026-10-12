// Self-contained design system for the public shared report. Kept apart
// from the operator dashboard's styles on purpose: this page is seen by
// outsiders and should stand on its own. It follows the same rules as the
// dashboard though: centred cards, >= 12px text, >= 40px controls,
// >= 56px list rows, long lists inside collapsible sections.
export const SHARE_CSS = `
/* Persian text and Persian digits both need a face that actually draws
   them. system-ui resolves to Roboto / Segoe UI, which carry no Persian
   glyphs, so the browser silently substituted a fallback per-glyph — the
   reason the script looked flat and the numbers looked pasted in.
   The app's own Vazirmatn (bundled, no network) comes first; the CDN copy
   below stays as a fallback and the old stack behind it. */
@font-face{font-family:Vazirmatn;font-style:normal;font-weight:400;font-display:swap;
  src:url(https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Regular.woff2) format("woff2")}
@font-face{font-family:Vazirmatn;font-style:normal;font-weight:700;font-display:swap;
  src:url(https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2) format("woff2")}
@font-face{font-family:Vazirmatn;font-style:normal;font-weight:800;font-display:swap;
  src:url(https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-ExtraBold.woff2) format("woff2")}
.sg{
  --bg:#080c17; --bg2:#0d1424; --card:#111a2e; --card2:#16203a;
  --line:#1e2b47; --line2:#2b3b5e; --txt:#e8eefc; --dim:#93a3c4; --dim2:#7d8fb3;
  --acc:#6d8cff; --done:#2fd48f; --prog:#ffb02e; --stall:#ff6b6b; --ann:#7c8db5;
  --radius:16px;
  /* The shared Section / EmptyState components read the dashboard tokens;
     map them onto this page's palette so they match the cards around them. */
  --color-surface:var(--card); --color-surface-2:var(--card2); --color-border:var(--line);
  --color-text:var(--txt); --color-text-dim:var(--dim); --color-accent:var(--acc);
  background:var(--bg); color:var(--txt); min-height:100vh; text-align:center;
  font-family:"Vazirmatn Variable",Vazirmatn,system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;
  font-feature-settings:"ss01";
  -webkit-font-smoothing:antialiased;
}
.sg *{box-sizing:border-box}
.sg button{font-family:inherit}
.sg button:focus-visible,.sg input:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.sg-wrap{max-width:1120px;margin:0 auto;padding:0 16px}
.sg-main{padding-bottom:64px}

/* HERO */
.sg-hero{position:relative;overflow:hidden;padding:40px 0 24px;
  background:linear-gradient(180deg,#0b1222 0%,var(--bg) 100%);
  border-bottom:1px solid var(--line)}
.sg-hero-glow{position:absolute;inset:-40% 20% auto 20%;height:360px;pointer-events:none;
  background:radial-gradient(closest-side,rgba(109,140,255,.22),transparent 70%);filter:blur(10px)}
.sg-hero .sg-wrap{position:relative}
.sg-eyebrow{font-size:12px;letter-spacing:.08em;color:var(--acc);font-weight:700;margin-bottom:10px}
.sg-title{font-size:clamp(24px,6.4vw,42px);line-height:1.35;font-weight:800;margin:0 0 14px;
  overflow-wrap:anywhere;
  background:linear-gradient(180deg,#fff,#b9c8ee);-webkit-background-clip:text;background-clip:text;
  -webkit-text-fill-color:transparent}
.sg-overview{max-width:68ch;margin:0 auto 16px;font-size:14px;line-height:2;color:var(--dim);white-space:pre-wrap}
.sg-meta{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;font-size:12px;color:var(--dim)}
.sg-meta-item{padding:5px 12px;border-radius:999px;border:1px solid var(--line);background:var(--card);line-height:1.6}
.sg-meta-item b{color:var(--txt);font-weight:700}
.sg-fresh{font-size:12px;padding:5px 12px;border-radius:999px;line-height:1.6;
  border:1px solid var(--line);background:var(--card)}
.sg-fresh--ok{color:var(--done);border-color:rgba(47,212,143,.35);background:rgba(47,212,143,.08)}
.sg-fresh--warn{color:var(--prog);border-color:rgba(255,176,46,.35);background:rgba(255,176,46,.08)}
.sg-fresh--old{color:var(--stall);border-color:rgba(255,107,107,.4);background:rgba(255,107,107,.1)}
.sg-chips{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:8px;
  max-width:560px;margin:20px auto 0}
.sg-chip{min-height:44px;font-size:13px;padding:8px 12px;border-radius:12px;cursor:pointer;
  border:1px solid var(--line);background:var(--card);color:var(--dim);transition:.15s}
.sg-chip:hover:not(:disabled){border-color:var(--acc);color:var(--txt)}
.sg-chip.is-on{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:700}
.sg-chip:disabled{opacity:.5;cursor:default}
.sg-note{margin-top:12px;font-size:12px;line-height:1.8;color:var(--prog)}

/* PULSE */
.sg-pulse{display:grid;grid-template-columns:1fr;gap:12px;margin:20px 0 12px}
@media(min-width:820px){.sg-pulse{grid-template-columns:minmax(260px,320px) 1fr;gap:16px;margin:28px 0 16px}}
.sg-ring-card{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
  padding:20px 16px;border-radius:var(--radius);
  background:linear-gradient(160deg,var(--card2),var(--card));border:1px solid var(--line)}
.sg-ring{position:relative;flex:none;width:124px;height:124px}
.sg-ring-svg{width:100%;height:100%;transform:rotate(-90deg)}
.sg-ring-bg{fill:none;stroke:#1c2842;stroke-width:11}
.sg-ring-fg{fill:none;stroke:url(#sgRingGrad);stroke-width:11;stroke-linecap:round;
  filter:drop-shadow(0 0 6px rgba(47,212,143,.35));
  transition:stroke-dashoffset .9s cubic-bezier(.4,0,.2,1)}
.sg-ring-num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:1px}
.sg-ring-num b{font-size:28px;font-weight:800}
.sg-ring-num span{font-size:13px;color:var(--dim)}
.sg-ring-label{font-size:15px;font-weight:700;margin-bottom:4px}
.sg-ring-sub{font-size:13px;color:var(--dim);line-height:1.9}
.sg-ring-sub b{color:var(--txt)}
.sg-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
@media(min-width:560px){.sg-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
.sg-kpi{padding:16px 10px 12px;border-radius:14px;background:var(--card);border:1px solid var(--line);
  position:relative;overflow:hidden;text-align:center;
  display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:92px}
.sg-kpi::before{content:"";position:absolute;inset-inline:0;top:0;height:3px;background:var(--dim2)}
.sg-kpi--done::before{background:var(--done)} .sg-kpi--prog::before{background:var(--prog)}
.sg-kpi--stall::before{background:var(--stall)} .sg-kpi--over::before{background:#ff8f5a}
.sg-kpi--base::before{background:var(--acc)}
.sg-kpi-n{font-size:26px;font-weight:800;line-height:1.3}
.sg-kpi-l{font-size:12px;color:var(--dim);margin-top:2px;line-height:1.5}

/* CARD */
.sg-card{margin-bottom:12px;padding:18px 16px;border-radius:var(--radius);background:var(--card);border:1px solid var(--line)}
.sg-h2{font-size:16px;font-weight:800;margin:0 0 14px;line-height:1.6}

/* DISTRIBUTION */
.sg-bar{display:flex;height:16px;border-radius:999px;background:#0a1120;gap:3px;padding:0;overflow:hidden}
.sg-bar-seg{transition:width .8s cubic-bezier(.4,0,.2,1);border-radius:999px;min-width:0}
.sg-done{background:var(--done)} .sg-prog{background:var(--prog)}
.sg-stall{background:var(--stall)} .sg-ann{background:var(--ann)}
.sg-legend{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:14px;font-size:13px;color:var(--dim)}
@media(min-width:620px){.sg-legend{grid-template-columns:repeat(4,minmax(0,1fr))}}
.sg-leg{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 7px;min-height:44px;
  padding:6px 8px;border-radius:12px;background:var(--card2);line-height:1.5}
.sg-leg b{color:var(--txt)}
.sg-leg em{font-style:normal;color:var(--dim2);font-size:12px}
.sg-swatch{width:10px;height:10px;border-radius:3px;display:inline-block}

/* Speaker attribution on a quote. Three quotes in a row with no names
   read as one voice arguing with itself. */
.sg-ev{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--dim);line-height:1.9}
.sg-ev li{padding:8px 12px;border-radius:10px;background:var(--card2)}
.sg-ev-who{display:block;color:var(--txt);font-weight:700}
.sg-ev-q{display:block}

/* CRITICAL / HIGHLIGHTS / PEOPLE / TOPICS: stacked, centred cards */
.sg-crit-grid,.sg-hl-grid,.sg-people,.sg-topics{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
@media(min-width:700px){.sg-crit-grid,.sg-hl-grid,.sg-people,.sg-topics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(min-width:1020px){.sg-people,.sg-topics{grid-template-columns:repeat(3,minmax(0,1fr))}}
.sg-crit,.sg-hl,.sg-person,.sg-topic{display:flex;flex-direction:column;align-items:center;
  padding:16px 14px;border-radius:14px;background:var(--card2);border:1px solid var(--line);min-width:0}
.sg-crit{border-color:rgba(255,107,107,.28);
  background:linear-gradient(160deg,rgba(255,107,107,.09),var(--card2))}
.sg-crit-top,.sg-hl-head{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-bottom:10px}
.sg-crit-title,.sg-hl h3{font-size:14px;font-weight:700;margin:0 0 8px;line-height:1.8}
.sg-crit-body,.sg-hl p{font-size:13px;color:var(--dim);line-height:1.9;margin:0}
.sg-crit-body{margin-bottom:12px}
.sg-hl{border-top:3px solid var(--ann)}
.sg-hl--win{border-top-color:var(--done)}
.sg-hl--risk,.sg-hl--conflict{border-top-color:var(--stall)}
.sg-hl--overdue,.sg-hl--stalled{border-top-color:var(--prog)}
.sg-faces{display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap}
.sg-face{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-size:12px;
  font-weight:700;background:var(--card);border:1px solid var(--line2);color:var(--dim)}
.sg-faces-txt{flex-basis:100%;font-size:12px;line-height:1.8;color:var(--dim2)}

/* PEOPLE */
.sg-avatar{flex:none;width:48px;height:48px;border-radius:50%;display:grid;place-items:center;
  font-size:15px;font-weight:800;color:#fff;background:linear-gradient(145deg,var(--acc),#4a63c9);margin-bottom:8px}
.sg-person h3,.sg-topic h3{font-size:14px;font-weight:700;margin:0 0 6px;line-height:1.7}
.sg-person-desc{font-size:12px;color:var(--dim);line-height:1.8;margin:6px 0 0}
.sg-pbar,.sg-tbar{width:100%;height:6px;border-radius:999px;background:#0a1120;overflow:hidden;margin:10px 0 8px}
.sg-pbar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--done),#7ce6b8);
  transition:width .8s cubic-bezier(.4,0,.2,1)}
.sg-person-stats{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 14px;font-size:12px;color:var(--dim);align-items:center}
.sg-person-stats b{color:var(--txt)}
.sg-rate{color:var(--done);font-weight:700}

/* TOPICS */
.sg-topic-n{font-size:12px;color:var(--dim2)}
.sg-tbar-fill{height:100%;background:linear-gradient(90deg,var(--acc),#9db4ff);border-radius:999px}
.sg-topic-sum{font-size:13px;color:var(--dim);line-height:1.9;margin:0 0 12px}
.sg-topic-foot{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;align-items:center;font-size:12px;color:var(--dim2)}
.sg-kp{list-style:none;margin:12px 0 0;padding:0;width:100%;display:flex;flex-direction:column;gap:6px;
  font-size:12px;color:var(--dim);line-height:1.9}
.sg-kp li{padding:8px 12px;border-radius:10px;background:var(--card)}

/* TASKS */
.sg-toolbar{display:grid;gap:8px;margin-bottom:12px}
.sg-search{width:100%;min-height:44px;padding:10px 14px;border-radius:12px;font-size:14px;font-family:inherit;
  text-align:start;background:var(--card2);border:1px solid var(--line);color:var(--txt)}
.sg-search::placeholder{color:var(--dim2)}
.sg-search:focus{outline:none;border-color:var(--acc)}
.sg-filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
@media(max-width:619px){.sg-filters>:last-child:nth-child(odd){grid-column:1/-1}}
@media(min-width:620px){.sg-filters{grid-template-columns:repeat(5,minmax(0,1fr))}}
.sg-fbtn{min-height:44px;font-size:12px;padding:6px 8px;border-radius:10px;cursor:pointer;line-height:1.5;
  background:var(--card2);border:1px solid var(--line);color:var(--dim);transition:.15s}
.sg-fbtn:hover{color:var(--txt);border-color:var(--line2)}
.sg-fbtn.is-on{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:700}
.sg-tasks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.sg-task{border-radius:12px;background:var(--card2);border:1px solid var(--line);
  border-inline-start:3px solid var(--ann);overflow:hidden;transition:.15s;min-width:0}
.sg-task:hover{border-color:var(--line2)}
.sg-task.sg-st-done{border-inline-start-color:var(--done)}
.sg-task.sg-st-prog{border-inline-start-color:var(--prog)}
.sg-task.sg-st-stall{border-inline-start-color:var(--stall)}
.sg-task.is-open{border-color:var(--acc)}
.sg-task-head{width:100%;min-height:56px;display:flex;flex-direction:column;align-items:center;gap:6px;
  padding:10px 34px;cursor:pointer;background:none;border:none;color:inherit;text-align:center;font-size:13px;position:relative}
.sg-task-title{display:block;width:100%;font-size:14px;font-weight:600;line-height:1.8;overflow-wrap:anywhere;
  overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.sg-task.is-open .sg-task-title{display:block;-webkit-line-clamp:unset;overflow:visible}
.sg-task-tags{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:100%}
.sg-caret{position:absolute;inset-inline-start:10px;top:50%;margin-top:-8px;color:var(--dim2);line-height:1}
.sg-caret svg{display:block;transition:transform .15s}
.sg-task.is-open .sg-caret svg{transform:rotate(180deg)}
.sg-task-body{padding:12px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:10px}
.sg-dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0}
.sg-dl>div{min-width:0;padding:8px;border-radius:10px;background:var(--card)}
.sg-dl>div:last-child:nth-child(odd){grid-column:1/-1}
.sg-dl dt{font-size:12px;color:var(--dim2);margin-bottom:2px}
.sg-dl dd{font-size:13px;margin:0;font-weight:600;line-height:1.7;overflow-wrap:anywhere}
.sg-block{font-size:12px;color:var(--stall);background:rgba(255,107,107,.08);padding:9px 12px;
  border-radius:10px;margin:0;line-height:1.8}
.sg-more{width:100%;min-height:48px;margin-top:10px;padding:12px;border-radius:12px;cursor:pointer;
  font-size:13px;background:var(--card2);border:1px dashed var(--line2);color:var(--dim);transition:.15s}
.sg-more:hover{color:var(--txt);border-color:var(--acc)}
.sg-none{padding:28px 16px;text-align:center;color:var(--dim);font-size:13px;
  background:var(--card2);border:1px dashed var(--line2);border-radius:12px}

/* TAGS / PILLS (all >= 12px) */
.sg-tag,.sg-pill{display:inline-flex;align-items:center;max-width:100%;font-size:12px;line-height:1.6;
  padding:2px 10px;border-radius:999px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  background:var(--card);border:1px solid var(--line);color:var(--dim)}
.sg-tag--red{background:rgba(255,107,107,.14);border-color:rgba(255,107,107,.32);color:#ffb3b3}
.sg-pill--bad{background:rgba(255,107,107,.14);border-color:rgba(255,107,107,.32);color:#ffb3b3}
.sg-pill--warn{background:rgba(255,176,46,.13);border-color:rgba(255,176,46,.3);color:#ffd591}
.sg-pill--ok{background:rgba(47,212,143,.12);border-color:rgba(47,212,143,.3);color:#8df0c4}
.sg-pill--info{background:rgba(109,140,255,.14);border-color:rgba(109,140,255,.32);color:#b6c6ff}
.sg-pill--ghost{background:transparent;color:var(--dim2)}

/* STATES */
.sg-dim{opacity:.45;transition:opacity .2s;pointer-events:none}
.sg-error{display:flex;flex-direction:column;align-items:center;gap:12px;
  padding:24px 16px;border-radius:var(--radius);margin:20px 0;font-size:14px;line-height:1.9;
  background:rgba(255,107,107,.08);border:1px solid rgba(255,107,107,.3);color:#ffb3b3}
.sg-error-ico{font-size:28px;line-height:1}
.sg-btn{min-height:44px;padding:8px 20px;border-radius:12px;cursor:pointer;font-size:14px;
  background:var(--card);border:1px solid var(--line2);color:var(--txt)}
.sg-btn:hover{border-color:var(--acc)}
.sg-skel{display:grid;gap:12px;margin:20px 0}
.sg-skel-txt{font-size:13px;color:var(--dim);padding:4px 0}
.sg-skel-box{height:88px;border-radius:14px;background:var(--card);border:1px solid var(--line);
  animation:sgpulse 1.4s ease-in-out infinite}
@keyframes sgpulse{0%,100%{opacity:.55}50%{opacity:1}}
.sg-empty{margin:20px 0}
.sg-footer{margin-top:32px;padding-top:20px;border-top:1px solid var(--line);
  font-size:12px;color:var(--dim2);text-align:center}

@media print{
  .sg{background:#fff;color:#000}
  .sg-chips,.sg-toolbar,.sg-more,.sg-caret{display:none}
  .sg-card,.sg-task,.sg-hl,.sg-crit,.sg-person,.sg-topic{break-inside:avoid}
}
`;
