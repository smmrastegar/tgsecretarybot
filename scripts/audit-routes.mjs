#!/usr/bin/env node
// Access audit: every API route is either behind the dashboard-session middleware or listed in
// PUBLIC_PREFIXES (middleware.ts), where it must authenticate itself. This lists the public ones and
// whether their source shows a recognised guard. A route without one is a finding to review, not
// necessarily a bug (some are intentionally open: telegram webhook has its own secret header, etc.).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const mw = fs.readFileSync(path.join(root, "middleware.ts"), "utf8");
const prefixes = [...mw.matchAll(/^\s*"(\/[^"]*)",?\s*$/gm)].map((m) => m[1]);
// STRONG = an explicit check of who is calling. BY_DESIGN = routes whose URL itself carries the secret (board /
// public share / email token) or that are the login flow. Anything public that is neither needs a human look.
const STRONG = /requireSession|requireSessionOr401|getCurrentSession|musicAccess|guardTrack|authorized\(|x-deploy-token|timingSafeEqual|cronSecret|CRON_SECRET|secret_token|verifyTelegram|findCodeFeed|createHmac|readSignedState|Bearer|authorizeMusic|getEmailAccountByToken|getCodeFeedByToken|secretToken|searchParams\.get\("token"\)|x-insta-token|x-webhook-token/;
const BY_DESIGN = /^\/api\/(auth|board|public)\//;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name === "route.ts") yield p;
  }
}
const isPublic = (url) => prefixes.some((p) => url === p || url.startsWith(p + "/"));
const rows = [];
for (const f of walk(path.join(root, "app/api"))) {
  const url = "/" + path.relative(path.join(root, "app"), path.dirname(f)).split(path.sep).join("/");
  const src = fs.readFileSync(f, "utf8");
  const methods = [...src.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)/g)].map((m) => m[1]);
  rows.push({ url, pub: isPublic(url), guarded: STRONG.test(src) || BY_DESIGN.test(url), methods: methods.join(",") });
}
const pub = rows.filter((r) => r.pub);
const bad = pub.filter((r) => !r.guarded);
console.log(`routes: ${rows.length} · behind session middleware: ${rows.length - pub.length} · public (self-authenticated): ${pub.length} · public WITHOUT a recognised guard: ${bad.length}`);
for (const r of bad) console.log(`  ✗ ${r.url} [${r.methods}]`);
if (process.argv.includes("--all")) for (const r of pub.filter((x) => x.guarded)) console.log(`  ✓ ${r.url} [${r.methods}]`);
process.exit(bad.length ? 1 : 0);
