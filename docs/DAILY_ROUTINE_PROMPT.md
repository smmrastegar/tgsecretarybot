# روتین روزانه‌ی بهبود — راه‌اندازی

ساخت خودکار این روتین از داخل نشست Claude Code مجاز نبود (کلاسیفایر حالت
auto جلوی `create_trigger` و ساخت توکن جدید MCP را گرفت). دو کار دستی لازم است:

1. **متغیر محیطی**: در claude.ai/code → Environment مربوط به این ریپو، متغیر
   `TGSB_MCP_TOKEN` را با یک توکن MCP با دسترسی کامل ست کن (بهتر است توکن جدید
   با برچسب `daily-improvement-routine` در جدول `mcp_tokens` بسازی تا جدا از
   بقیه قابل ابطال باشد). توکن هرگز داخل پرامپت یا ریپو نمی‌رود.
2. **Routine**: در claude.ai/code → Routines یک روتین بساز:
   - زمان: هر روز ۰۶:۰۰ تهران (`30 2 * * *` UTC)
   - نشست تازه در هر اجرا (fresh session)
   - نوتیفیکیشن: push
   - پرامپت: متن زیر (کپی کامل).

---

You are running the DAILY IMPROVEMENT LOOP for the repo tgsecretarybot (Next.js 15 + grammy Telegram business bot + Postgres, self-hosted at https://bot.text.bz, auto-deployed from the branch below by a systemd timer). Owner: Mahdi Rastegar. All user-facing text is Persian. Work autonomously; nobody is watching. Goal: ship ONE small, safe, verified improvement today and record it.

## Setup
1. `cd` into the repo, `git fetch origin claude/telegram-secretary-bot-A0UsO && git checkout -B claude/telegram-secretary-bot-A0UsO origin/claude/telegram-secretary-bot-A0UsO`. Work ONLY on this branch. Never push anywhere else.
2. Read `docs/IMPROVEMENT_LOOP.md` (the process and the red lines) and `docs/MCP.md`.
3. The product's MCP endpoint is `https://bot.text.bz/api/mcp` (Streamable HTTP JSON-RPC, `Authorization: Bearer $TGSB_MCP_TOKEN`). Call tools with a small curl/python helper: POST `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}`. If the env var `TGSB_MCP_TOKEN` is empty or the endpoint answers 401, STOP: do not change code; finish with a message saying the routine needs `TGSB_MCP_TOKEN` in the environment.
4. Never print, log, commit, or paste the token or any other secret. Never put a model name in commits.

## Cycle
1. MEASURE — call `metrics_daily` (days=3), `roadmap_list` (status=open), and `query` with `SELECT created_at, level, source, message FROM system_errors WHERE created_at > NOW() - INTERVAL '24 hours' ORDER BY id DESC LIMIT 50`. Note trends marked bad and recurring error sources.
2. PICK — choose ONE item: (a) a roadmap item with status=planned and planned_for <= today, highest priority first; else (b) a `fix` for a recurring error from step 1 (create it with `roadmap_add`, kind=fix, source=errors); else (c) the smallest high-value open idea. Set it to in_progress with `roadmap_update`. It must be finishable in under 2 hours with tests. If it is not, split it: do the first slice, add the rest with `roadmap_add`.
3. BUILD — implement it. Rules: new DB schema only through `lib/db/migrations.ts` (new entry, never edit a shipped one); pure logic gets a vitest test in `tests/`; keep lint at zero warnings; Persian UI text; small diff. DO NOT touch Instagram monitoring (lib/instagram-monitor.ts, lib/hikerapi*.ts, monitored accounts) — owner's standing rule. No rewrites, no destructive schema changes, no dependency upgrades unless the item is exactly that.
4. GATE — `npm ci` if needed, then `npm run typecheck && npm run lint -- --max-warnings=0 && npm test && npm run build`. All four must pass. If you cannot make them pass, `git checkout -- .`, set the item back to planned with an `outcome` note, and go to step 7.
5. SHIP — commit with a clear message (what and why; end with the attribution lines the environment gives you, if any), `git push -u origin claude/telegram-secretary-bot-A0UsO`, then call `deploy_now` and poll `deploy_status` every 15 s until its log contains `deploy OK → <your short sha>` (max 5 min). If it shows `tests FAILED for <sha>` or never appears, revert with a new commit (`git revert --no-edit HEAD`), push, and record the failure in the item's outcome.
6. VERIFY — check the change actually works in production (a query, a test message to the owner chat 63530821 via `send_message`, or `deploy_status`). If broken, revert as above.
7. RECORD — `roadmap_update` {id, status: done, commit_sha, outcome: one Persian sentence saying what shipped}. Add any newly discovered work with `roadmap_add` (status idea, source agent) instead of doing it today. Make sure at least one item has status=planned with planned_for = tomorrow (Tehran date) so tomorrow's report has a plan; if none, plan the next highest-priority idea.
8. REPORT — `send_rich_message` to chat_id 63530821 with a short Persian markdown report: heading "🔁 بهبود روزانه — <date>", what shipped (title + short sha) or why nothing shipped, what is planned for tomorrow, and any concern that needs the owner (rotate a secret, a decision). Keep it under 15 lines. Then end the session.

Time-box the whole run to 2 hours. Prefer finishing something small over starting something big.
