// Self-contained design system for the public shared report. Kept apart
// from the operator dashboard's styles on purpose: this page is seen by
// outsiders and should stand on its own.
export const SHARE_CSS = `
/* Persian text and Persian digits both need a face that actually draws
   them. system-ui resolves to Roboto / Segoe UI, which carry no Persian
   glyphs, so the browser silently substituted a fallback per-glyph — the
   reason the script looked flat and the numbers looked pasted in.
   Vazirmatn is loaded with swap so the page never blocks on it, and the
   old stack stays behind it as the fallback. */
@font-face{font-family:Vazirmatn;font-style:normal;font-weight:400;font-display:swap;
  src:url(https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Regular.woff2) format("woff2")}
@font-face{font-family:Vazirmatn;font-style:normal;font-weight:700;font-display:swap;
  src:url(https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2) format("woff2")}
@font-face{font-family:Vazirmatn;font-style:normal;font-weight:800;font-display:swap;
  src:url(https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-ExtraBold.woff2) format("woff2")}
.sg{
  --bg:#080c17; --bg2:#0d1424; --card:#111a2e; --card2:#16203a;
  --line:#1e2b47; --line2:#2b3b5e; --txt:#e8eefc; --dim:#93a3c4; --dim2:#66789c;
  --acc:#6d8cff; --done:#2fd48f; --prog:#ffb02e; --stall:#ff6b6b; --ann:#7c8db5;
  --radius:16px;
  background:var(--bg); color:var(--txt); min-height:100vh;
  font-family:Vazirmatn,system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;
  font-feature-settings:"ss01";
  -webkit-font-smoothing:antialiased;
}
.sg *{box-sizing:border-box}
.sg-wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.sg-main{padding-bottom:80px}

/* HERO */
.sg-hero{position:relative;overflow:hidden;padding:56px 0 32px;
  background:linear-gradient(180deg,#0b1222 0%,var(--bg) 100%);
  border-bottom:1px solid var(--line)}
.sg-hero-glow{position:absolute;inset:-40% 30% auto -10%;height:420px;pointer-events:none;
  background:radial-gradient(closest-side,rgba(109,140,255,.22),transparent 70%);filter:blur(10px)}
.sg-eyebrow{font-size:12px;letter-spacing:.14em;color:var(--acc);font-weight:700;margin-bottom:10px}
.sg-title{font-size:clamp(26px,4.4vw,44px);line-height:1.2;font-weight:800;margin:0 0 14px;
  background:linear-gradient(180deg,#fff,#b9c8ee);-webkit-background-clip:text;background-clip:text;
  -webkit-text-fill-color:transparent}
.sg-overview{max-width:78ch;font-size:15px;line-height:2;color:var(--dim);margin:0 0 18px;white-space:pre-wrap}
.sg-meta{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:13px;color:var(--dim)}
.sg-meta-item b{color:var(--txt);font-weight:700}
.sg-dot{width:3px;height:3px;border-radius:50%;background:var(--dim2)}
.sg-fresh{margin-inline-start:auto;font-size:12px;padding:5px 12px;border-radius:999px;
  border:1px solid var(--line);background:var(--card)}
.sg-fresh--ok{color:var(--done);border-color:rgba(47,212,143,.35);background:rgba(47,212,143,.08)}
.sg-fresh--warn{color:var(--prog);border-color:rgba(255,176,46,.35);background:rgba(255,176,46,.08)}
.sg-fresh--old{color:var(--stall);border-color:rgba(255,107,107,.4);background:rgba(255,107,107,.1)}
.sg-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
.sg-chip{font-size:13px;padding:8px 16px;border-radius:999px;cursor:pointer;
  border:1px solid var(--line);background:var(--card);color:var(--dim);transition:.15s}
.sg-chip:hover:not(:disabled){border-color:var(--acc);color:var(--txt)}
.sg-chip.is-on{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:700}
.sg-chip:disabled{opacity:.5;cursor:default}
.sg-note{margin-top:12px;font-size:12px;color:var(--prog)}

/* PULSE */
.sg-pulse{display:grid;grid-template-columns:minmax(240px,300px) 1fr;gap:16px;margin:28px 0}
@media(max-width:820px){.sg-pulse{grid-template-columns:1fr}}
.sg-ring-card{display:flex;align-items:center;gap:18px;padding:22px;border-radius:var(--radius);
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
.sg-ring-label{font-size:15px;font-weight:700;margin-bottom:6px}
.sg-ring-sub{font-size:12px;color:var(--dim);line-height:1.9}
.sg-ring-sub b{color:var(--txt)}
.sg-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:12px;justify-items:stretch}
.sg-kpi{padding:18px 14px;border-radius:14px;background:var(--card);border:1px solid var(--line);
  position:relative;overflow:hidden;transition:.15s;text-align:center;
  display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:96px}
.sg-kpi:hover{transform:translateY(-2px);border-color:var(--line2)}
.sg-kpi::before{content:"";position:absolute;inset-inline-start:0;top:0;bottom:0;width:3px;background:var(--dim2)}
.sg-kpi--done::before{background:var(--done)} .sg-kpi--prog::before{background:var(--prog)}
.sg-kpi--stall::before{background:var(--stall)} .sg-kpi--over::before{background:#ff8f5a}
.sg-kpi--base::before{background:var(--acc)}
.sg-kpi-n{font-size:28px;font-weight:800;line-height:1.15;letter-spacing:.01em}
.sg-kpi-l{font-size:12px;color:var(--dim);margin-top:6px;line-height:1.5}

/* CARD / SECTION */
.sg-card,.sg-sec{margin-bottom:28px}
.sg-card{padding:22px;border-radius:var(--radius);background:var(--card);border:1px solid var(--line)}
.sg-h2{display:flex;align-items:center;gap:9px;font-size:17px;font-weight:800;margin:0 0 16px}
.sg-h2-ico{font-size:19px}

/* DISTRIBUTION */
.sg-bar{display:flex;height:18px;border-radius:999px;background:#0a1120;gap:3px;padding:0;overflow:hidden}
.sg-bar-seg{transition:width .8s cubic-bezier(.4,0,.2,1);border-radius:999px;min-width:0}
.sg-done{background:var(--done)} .sg-prog{background:var(--prog)}
.sg-stall{background:var(--stall)} .sg-ann{background:var(--ann)}
.sg-legend{display:flex;flex-wrap:wrap;gap:18px;margin-top:16px;font-size:13px;color:var(--dim)}
.sg-leg{display:flex;align-items:center;gap:7px}
.sg-leg b{color:var(--txt)}
.sg-leg em{font-style:normal;color:var(--dim2);font-size:12px}
.sg-swatch{width:10px;height:10px;border-radius:3px;display:inline-block}

/* CRITICAL */
.sg-crit-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.sg-crit{padding:18px;border-radius:14px;border:1px solid rgba(255,107,107,.28);
  background:linear-gradient(160deg,rgba(255,107,107,.09),var(--card))}
.sg-crit-top{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.sg-crit-title{font-size:15px;font-weight:700;margin:0 0 8px;line-height:1.6}
.sg-crit-body{font-size:13px;color:var(--dim);line-height:1.9;margin:0 0 12px}
.sg-faces{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.sg-face{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:10px;
  font-weight:700;background:var(--card2);border:1px solid var(--line2);color:var(--dim)}
.sg-faces-txt{font-size:12px;color:var(--dim2)}

/* HIGHLIGHTS */
.sg-hl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.sg-hl{padding:16px;border-radius:14px;background:var(--card);border:1px solid var(--line);
  border-inline-start:3px solid var(--ann)}
.sg-hl--win{border-inline-start-color:var(--done)}
.sg-hl--risk,.sg-hl--conflict{border-inline-start-color:var(--stall)}
.sg-hl--overdue,.sg-hl--stalled{border-inline-start-color:var(--prog)}
.sg-hl-head{display:flex;justify-content:space-between;gap:8px;margin-bottom:9px;align-items:center}
.sg-hl-topic{font-size:11px;color:var(--dim2)}
.sg-hl h3{font-size:14px;font-weight:700;margin:0 0 7px;line-height:1.6}
.sg-hl p{font-size:13px;color:var(--dim);line-height:1.9;margin:0}

/* PEOPLE */
.sg-people{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.sg-person{display:flex;gap:14px;padding:16px;border-radius:14px;background:var(--card);border:1px solid var(--line)}
.sg-avatar{flex:none;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;
  font-size:14px;font-weight:800;color:#fff;background:linear-gradient(145deg,var(--acc),#4a63c9)}
.sg-person-main{flex:1;min-width:0}
.sg-person-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px}
.sg-person-row h3{font-size:14px;font-weight:700;margin:0}
.sg-person-desc{font-size:12px;color:var(--dim);line-height:1.8;margin:0 0 9px}
.sg-pbar{height:6px;border-radius:999px;background:#0a1120;overflow:hidden;margin-bottom:8px}
.sg-pbar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--done),#7ce6b8);
  transition:width .8s cubic-bezier(.4,0,.2,1)}
.sg-person-stats{display:flex;gap:14px;font-size:12px;color:var(--dim);align-items:center}
.sg-person-stats b{color:var(--txt)}
.sg-rate{margin-inline-start:auto;color:var(--done);font-weight:700}

/* TOPICS */
.sg-topics{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.sg-topic{padding:18px;border-radius:14px;background:var(--card);border:1px solid var(--line)}
.sg-topic-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:10px}
.sg-topic-head h3{font-size:14px;font-weight:700;margin:0}
.sg-topic-n{font-size:12px;color:var(--dim2);white-space:nowrap}
.sg-tbar{height:5px;border-radius:999px;background:#0a1120;overflow:hidden;margin-bottom:12px}
.sg-tbar-fill{height:100%;background:linear-gradient(90deg,var(--acc),#9db4ff);border-radius:999px}
.sg-topic-sum{font-size:13px;color:var(--dim);line-height:1.9;margin:0 0 12px}
.sg-topic-foot{display:flex;flex-wrap:wrap;gap:7px;align-items:center;font-size:12px;color:var(--dim2)}
.sg-kp{margin:12px 0 0;padding-inline-start:16px;font-size:12px;color:var(--dim);line-height:2}

/* TASKS */
.sg-toolbar{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;align-items:center}
.sg-search{flex:1;min-width:200px;padding:10px 14px;border-radius:10px;font-size:13px;font-family:inherit;
  background:var(--card);border:1px solid var(--line);color:var(--txt)}
.sg-search:focus{outline:none;border-color:var(--acc)}
.sg-filters{display:flex;flex-wrap:wrap;gap:6px}
.sg-fbtn{font-size:12px;padding:8px 13px;border-radius:8px;cursor:pointer;
  background:var(--card);border:1px solid var(--line);color:var(--dim);transition:.15s}
.sg-fbtn:hover{color:var(--txt);border-color:var(--line2)}
.sg-fbtn.is-on{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:700}
.sg-tasks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.sg-task{border-radius:12px;background:var(--card);border:1px solid var(--line);overflow:hidden;transition:.15s}
.sg-task:hover{border-color:var(--line2)}
.sg-task.is-open{border-color:var(--acc)}
.sg-task-head{width:100%;display:flex;align-items:center;gap:11px;padding:13px 15px;cursor:pointer;
  background:none;border:none;color:inherit;text-align:start;font-family:inherit;font-size:13px}
.sg-dotst{flex:none;width:9px;height:9px;border-radius:50%}
.sg-task-title{flex:1;min-width:0;font-weight:600;line-height:1.6;
  overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.sg-task-tags{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
.sg-caret{flex:none;font-size:9px;color:var(--dim2)}
.sg-task-body{padding:0 15px 15px;border-top:1px solid var(--line);margin-top:2px;padding-top:13px}
.sg-dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:11px;margin:0 0 11px}
.sg-dl div{min-width:0}
.sg-dl dt{font-size:11px;color:var(--dim2);margin-bottom:3px}
.sg-dl dd{font-size:13px;margin:0;font-weight:600}
.sg-block{font-size:12px;color:var(--stall);background:rgba(255,107,107,.08);padding:9px 12px;
  border-radius:8px;margin:0 0 10px;line-height:1.8}
.sg-ev{margin:0;padding-inline-start:16px;font-size:12px;color:var(--dim);line-height:2}
.sg-more{width:100%;margin-top:12px;padding:12px;border-radius:10px;cursor:pointer;font-family:inherit;
  font-size:13px;background:var(--card);border:1px dashed var(--line2);color:var(--dim);transition:.15s}
.sg-more:hover{color:var(--txt);border-color:var(--acc)}
.sg-none{padding:32px;text-align:center;color:var(--dim2);font-size:13px;
  background:var(--card);border:1px solid var(--line);border-radius:12px}

/* TAGS / PILLS */
.sg-tag,.sg-pill{font-size:11px;padding:3px 9px;border-radius:999px;white-space:nowrap;
  background:var(--card2);border:1px solid var(--line);color:var(--dim)}
.sg-tag--red{background:rgba(255,107,107,.14);border-color:rgba(255,107,107,.32);color:#ffb3b3}
.sg-pill--bad{background:rgba(255,107,107,.14);border-color:rgba(255,107,107,.32);color:#ffb3b3}
.sg-pill--warn{background:rgba(255,176,46,.13);border-color:rgba(255,176,46,.3);color:#ffd591}
.sg-pill--ghost{background:transparent;color:var(--dim2)}

/* STATES */
.sg-dim{opacity:.45;transition:opacity .2s;pointer-events:none}
.sg-error{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;
  padding:16px;border-radius:12px;margin:24px 0;font-size:13px;
  background:rgba(255,107,107,.08);border:1px solid rgba(255,107,107,.3);color:#ffb3b3}
.sg-btn{padding:8px 15px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;
  background:var(--card);border:1px solid var(--line2);color:var(--txt)}
.sg-skel{display:grid;gap:14px;margin:28px 0}
.sg-skel-box{height:88px;border-radius:14px;background:var(--card);border:1px solid var(--line);
  animation:sgpulse 1.4s ease-in-out infinite}
@keyframes sgpulse{0%,100%{opacity:.55}50%{opacity:1}}
.sg-empty{padding:64px 24px;text-align:center;margin:28px 0;
  background:var(--card);border:1px solid var(--line);border-radius:var(--radius)}
.sg-empty-ico{font-size:40px;margin-bottom:14px}
.sg-empty h3{font-size:16px;font-weight:700;margin:0 0 8px}
.sg-empty p{font-size:13px;color:var(--dim);margin:0}
.sg-footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);
  font-size:12px;color:var(--dim2);text-align:center}

@media print{
  .sg{background:#fff;color:#000}
  .sg-chips,.sg-toolbar,.sg-more,.sg-caret{display:none}
  .sg-card,.sg-task,.sg-hl,.sg-crit,.sg-person,.sg-topic{break-inside:avoid}
}
`;
