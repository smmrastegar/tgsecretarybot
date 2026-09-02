// Connection + schema for the database layer. Every other lib/db/*
// module imports sql/hasDb/ensureSchema from here.
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { config } from "../config";
import { driverKind, makeMysqlClient } from "../sql-driver";
import { makePgClient } from "../pg-driver";
import { neon } from "@neondatabase/serverless";

export let cached: NeonQueryFunction<false, false> | null = null;
let schemaPromise: Promise<void> | null = null;

// Bump this whenever the DDL in ensureSchema changes (new table / column
// / migration). ensureSchema runs ~350 idempotent DDL statements, each a
// network round-trip (~28s cold-start on a remote DB). When the DB
// already records this exact version, we skip all of them. If you add
// schema and forget to bump this, the new DDL won't run — so BUMP IT.
const SCHEMA_VERSION = "2026-08-28.rule-match-pattern";

export function hasDb(): boolean {
  return Boolean(config.databaseUrl);
}

// Returns the query client. On Postgres this is the neon tagged
// template; on MySQL/TiDB (DB_DRIVER=mysql or a mysql:// URL) it's a
// mysql2-backed client that translates the Postgres dialect at run
// time — same call surface, so the ~hundreds of query call sites don't
// change. See lib/sql-driver.ts.
export function sql(): NeonQueryFunction<false, false> {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!cached) {
    const kind = driverKind();
    if (kind === "mysql") {
      cached = makeMysqlClient() as unknown as NeonQueryFunction<false, false>;
    } else if (kind === "pg") {
      cached = makePgClient(
        config.databaseUrl,
      ) as unknown as NeonQueryFunction<false, false>;
    } else {
      cached = neon(config.databaseUrl);
    }
  }
  return cached;
}

// clientOverride runs the full DDL against a DIFFERENT database than
// the configured one (used to provision a TiDB target during migration
// via the MCP tools). When given, memoization is skipped.
export async function ensureSchema(
  clientOverride?: NeonQueryFunction<false, false>,
): Promise<void> {
  if (!clientOverride && schemaPromise) return schemaPromise;
  const run = (async () => {
    const q = clientOverride ?? sql();
    // Fast path: a DB already migrated to SCHEMA_VERSION skips the ~350
    // idempotent DDL round-trips (the cold-start 28s). On a fresh DB the
    // settings table doesn't exist yet → the query throws → we run the
    // full DDL below (and stamp the version at the end).
    if (!clientOverride) {
      const done = await q`
        SELECT 1 FROM settings WHERE key = 'schema.version' AND value = ${SCHEMA_VERSION} LIMIT 1`
        .then((r) => (r as unknown[]).length > 0)
        .catch(() => false);
      if (done) return;
    }
    await q`
      CREATE TABLE IF NOT EXISTS business_connections (
        id            TEXT PRIMARY KEY,
        user_id       BIGINT NOT NULL,
        user_chat_id  BIGINT NOT NULL,
        username      TEXT,
        first_name    TEXT,
        last_name     TEXT,
        can_reply     BOOLEAN NOT NULL DEFAULT FALSE,
        is_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`
      CREATE TABLE IF NOT EXISTS messages_log (
        id                     BIGSERIAL PRIMARY KEY,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        business_connection_id TEXT NOT NULL,
        owner_user_id          BIGINT,
        chat_id                BIGINT NOT NULL,
        chat_type              TEXT NOT NULL,
        chat_title             TEXT,
        sender_id              BIGINT,
        sender_username        TEXT,
        sender_name            TEXT NOT NULL,
        message_id             BIGINT NOT NULL,
        message_text           TEXT NOT NULL,
        importance             INT NOT NULL DEFAULT 0,
        urgent                 BOOLEAN NOT NULL DEFAULT FALSE,
        concerns_owner         BOOLEAN NOT NULL DEFAULT FALSE,
        reason                 TEXT NOT NULL DEFAULT '',
        alerted                BOOLEAN NOT NULL DEFAULT FALSE,
        auto_replied           BOOLEAN NOT NULL DEFAULT FALSE,
        handled_at             TIMESTAMPTZ,
        handled_by             BIGINT,
        notes                  TEXT
      )`;
    await q`CREATE INDEX IF NOT EXISTS messages_log_created_idx ON messages_log (created_at DESC)`;
    await q`CREATE INDEX IF NOT EXISTS messages_log_chat_idx ON messages_log (chat_id, created_at DESC)`;
    await q`CREATE INDEX IF NOT EXISTS messages_log_urgent_idx ON messages_log (urgent, created_at DESC) WHERE urgent = TRUE`;
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS from_owner BOOLEAN NOT NULL DEFAULT FALSE`;
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS skipped_reason TEXT`;
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS media_file_id TEXT`;
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS media_kind TEXT`;
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS transcript TEXT`;
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS transcript_at TIMESTAMPTZ`;
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS media_description TEXT`;
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS media_description_at TIMESTAMPTZ`;
    // Telegram pushes deleted_business_messages updates when either
    // side deletes a DM. We mark the matching rows so the dashboard
    // can show what was erased instead of silently losing it.
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
    await q`CREATE INDEX IF NOT EXISTS messages_log_deleted_idx ON messages_log (deleted_at) WHERE deleted_at IS NOT NULL`;
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`;
    // Edit history: when Telegram pushes edited_business_message we
    // snapshot the previous text/transcript here before overwriting
    // the live row, so the dashboard can show what was changed.
    await q`
      CREATE TABLE IF NOT EXISTS message_edits (
        id              BIGSERIAL PRIMARY KEY,
        message_log_id  BIGINT NOT NULL REFERENCES messages_log(id) ON DELETE CASCADE,
        previous_text   TEXT,
        previous_transcript TEXT,
        edited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE INDEX IF NOT EXISTS message_edits_msg_idx ON message_edits (message_log_id, edited_at DESC)`;
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS source TEXT`;
    await q`CREATE INDEX IF NOT EXISTS messages_log_source_idx ON messages_log (source) WHERE source IS NOT NULL`;
    // Inline URL buttons captured from msg.reply_markup. Channels
    // that act as email gateways attach HTML / Preview / Summary /
    // Text / Debug links to every post — we keep them so the
    // dashboard can render the proper HTML body on demand.
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS inline_buttons JSONB`;
    // Forum topics — supergroups can be split into topics (a.k.a.
    // threads). Every message in a forum carries msg.message_thread_id
    // pointing at the topic root. We store the id on every row so
    // /groups/[id] can section the analysis by topic. The name is
    // resolved separately via the forum_topics table (populated by
    // forum_topic_created / _edited events).
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS message_thread_id BIGINT`;
    await q`CREATE INDEX IF NOT EXISTS messages_log_thread_idx
      ON messages_log (chat_id, message_thread_id, created_at)
      WHERE message_thread_id IS NOT NULL`;
    await q`
      CREATE TABLE IF NOT EXISTS forum_topics (
        chat_id            BIGINT NOT NULL,
        message_thread_id  BIGINT NOT NULL,
        name               TEXT,
        icon_color         INT,
        icon_emoji         TEXT,
        is_closed          BOOLEAN NOT NULL DEFAULT FALSE,
        is_hidden          BOOLEAN NOT NULL DEFAULT FALSE,
        observed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (chat_id, message_thread_id)
      )`;
    await q`CREATE INDEX IF NOT EXISTS messages_log_owner_chat_idx ON messages_log (chat_id, created_at DESC) WHERE from_owner = TRUE`;
    // Groups arrive via regular bot.on("message"), not via business
    // connections — they don't have a bcId. Relax the NOT NULL so we
    // can log them.
    await q`ALTER TABLE messages_log ALTER COLUMN business_connection_id DROP NOT NULL`;
    // group_summaries — same reason: groups receiving messages via the
    // regular bot.on("message") path have no bcId.
    await q`ALTER TABLE group_summaries ALTER COLUMN business_connection_id DROP NOT NULL`;
    await q`
      CREATE TABLE IF NOT EXISTS chat_rules (
        chat_id      BIGINT PRIMARY KEY,
        chat_type    TEXT NOT NULL,
        chat_title   TEXT,
        vip          BOOLEAN NOT NULL DEFAULT FALSE,
        muted        BOOLEAN NOT NULL DEFAULT FALSE,
        custom_reply TEXT,
        notes        TEXT,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`
      CREATE TABLE IF NOT EXISTS settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by BIGINT
      )`;
    await q`
      CREATE TABLE IF NOT EXISTS group_summaries (
        id                     BIGSERIAL PRIMARY KEY,
        chat_id                BIGINT NOT NULL,
        chat_title             TEXT,
        business_connection_id TEXT NOT NULL,
        period_start           TIMESTAMPTZ NOT NULL,
        period_end             TIMESTAMPTZ NOT NULL,
        message_count          INT NOT NULL,
        active_senders         INT NOT NULL,
        summary                TEXT NOT NULL,
        topics                 JSONB NOT NULL DEFAULT '[]',
        action_items           JSONB NOT NULL DEFAULT '[]',
        mentions_owner         BOOLEAN NOT NULL DEFAULT FALSE,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (chat_id, period_start)
      )`;
    await q`CREATE INDEX IF NOT EXISTS group_summaries_chat_idx ON group_summaries (chat_id, period_start DESC)`;
    await q`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          BIGSERIAL PRIMARY KEY,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actor_id    BIGINT,
        actor_name  TEXT,
        action      TEXT NOT NULL,
        target      TEXT,
        details     JSONB
      )`;
    await q`CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log (created_at DESC)`;
    // System errors — anything the bot / cron / webhook caught and
    // wanted to surface in the dashboard. Source labels the
    // subsystem ("cron:follow-up", "webhook:telegram", etc.), level
    // is "warn" or "error", scope can be a chat id / message id for
    // drill-down. Capped retention via opportunistic prune.
    await q`
      CREATE TABLE IF NOT EXISTS system_errors (
        id          BIGSERIAL PRIMARY KEY,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        level       TEXT NOT NULL DEFAULT 'error',
        source      TEXT NOT NULL,
        message     TEXT NOT NULL,
        stack       TEXT,
        scope       TEXT,
        details     JSONB
      )`;
    await q`CREATE INDEX IF NOT EXISTS system_errors_created_idx ON system_errors (created_at DESC)`;
    await q`CREATE INDEX IF NOT EXISTS system_errors_source_idx ON system_errors (source, created_at DESC)`;
    await q`CREATE INDEX IF NOT EXISTS system_errors_level_idx ON system_errors (level, created_at DESC)`;
    await q`
      CREATE TABLE IF NOT EXISTS secretary_sessions (
        id                     BIGSERIAL PRIMARY KEY,
        business_connection_id TEXT    NOT NULL,
        sender_chat_id         BIGINT  NOT NULL,
        sender_name            TEXT,
        sender_username        TEXT,
        secretary_user_id      BIGINT  NOT NULL,
        secretary_chat_id      BIGINT  NOT NULL,
        header_message_id      BIGINT  NOT NULL,
        owner_user_id          BIGINT,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_activity_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at               TIMESTAMPTZ,
        end_reason             TEXT
      )`;
    await q`CREATE INDEX IF NOT EXISTS secretary_sessions_active_idx
      ON secretary_sessions (business_connection_id, sender_chat_id)
      WHERE ended_at IS NULL`;
    await q`
      CREATE TABLE IF NOT EXISTS secretary_message_links (
        id                  BIGSERIAL PRIMARY KEY,
        session_id          BIGINT NOT NULL REFERENCES secretary_sessions(id) ON DELETE CASCADE,
        secretary_chat_id   BIGINT NOT NULL,
        secretary_message_id BIGINT NOT NULL,
        direction           TEXT   NOT NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (secretary_chat_id, secretary_message_id)
      )`;
    await q`ALTER TABLE secretary_message_links ADD COLUMN IF NOT EXISTS sender_message_id BIGINT`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'off'`;
    await q`ALTER TABLE chat_rules ALTER COLUMN mode SET DEFAULT 'off'`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS mode_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS secretary_user_id BIGINT`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE`;
    // Backfill is_bot from messages_log: Telegram bot usernames must
    // end with "bot" (case-insensitive). Anything else stays FALSE and
    // the owner can manually flag it on /chats/[id].
    await q`
      UPDATE chat_rules SET is_bot = TRUE
      WHERE is_bot = FALSE
        AND chat_id IN (
          SELECT DISTINCT chat_id FROM messages_log
          WHERE sender_username ILIKE '%bot'
        )`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS first_name TEXT`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS last_name TEXT`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS nickname TEXT`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS relationship TEXT`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS grace_skipped_at TIMESTAMPTZ`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS relationship_notes TEXT`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS talk_style_notes TEXT`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS tone_profile TEXT`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS tone_profile_at TIMESTAMPTZ`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS flood_cooldown_until TIMESTAMPTZ`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS flood_deflected_at TIMESTAMPTZ`;
    // Per-chat opt-in: in ai_chat mode, treat incoming voice / sticker
    // / GIF (animation) as if it were text by transcribing or
    // describing it first, then letting the AI reply. Off by default
    // because both add ~$0.001 per message.
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS ai_process_voice BOOLEAN NOT NULL DEFAULT FALSE`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS ai_process_stickers BOOLEAN NOT NULL DEFAULT FALSE`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS ai_process_gifs BOOLEAN NOT NULL DEFAULT FALSE`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS ai_process_photos BOOLEAN NOT NULL DEFAULT FALSE`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS ai_process_video_notes BOOLEAN NOT NULL DEFAULT FALSE`;
    // Hard-ignore: when TRUE the bot drops every incoming message in
    // this chat at the very top of the pipeline — no classify, no
    // log, no rule eval, no SMS route, no auto-reply. For chats the
    // operator never wants the system to touch.
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS ignored BOOLEAN NOT NULL DEFAULT FALSE`;
    // Operator-entered phone number for this chat. Used by SMS
    // routing (findOwnerOfPhone) so we can resolve incoming SMS to
    // the right contact even when we've never seen them share a
    // contact card. Stored as the operator typed it; matching uses
    // the last-8-digit tail.
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS phone_number TEXT`;
    // SMS webhooks: each row is an independent inbound channel for
    // the Android SMS-Forwarder app (or any HTTP client). secret is
    // the per-webhook token in the URL; name is the chat_title that
    // gets stamped on messages flowing through it so /messages
    // shows them as a coherent stream per source.
    await q`
      CREATE TABLE IF NOT EXISTS sms_webhooks (
        id            BIGSERIAL PRIMARY KEY,
        name          TEXT NOT NULL,
        secret        TEXT NOT NULL UNIQUE,
        enabled       BOOLEAN NOT NULL DEFAULT TRUE,
        last_used_at  TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE INDEX IF NOT EXISTS sms_webhooks_secret_idx ON sms_webhooks (secret)`;
    // The same webhook table now hosts two kinds: 'sms' (the
    // original — pasted into the Android SMS-Forwarder app) and
    // 'insta' (URL hit by an external Instagram change-detector;
    // shape is /api/insta-webhook?token=…&action=story&id=<username>).
    await q`ALTER TABLE sms_webhooks ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'sms'`;
    // Per-webhook opt-in: AI classifies each incoming SMS; if it
    // looks like a personal one-to-one conversation (not OTP / bank /
    // promo / service), redact the body in the Telegram inbox + in
    // the dashboard. Body becomes visible only after the operator
    // hits "👁 نمایش متن".
    await q`ALTER TABLE sms_webhooks ADD COLUMN IF NOT EXISTS redact_private BOOLEAN NOT NULL DEFAULT FALSE`;
    // Mirror flag on the logged message so the dashboard and
    // dedup-edit code can render redacted without re-running AI.
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS is_private_conversation BOOLEAN NOT NULL DEFAULT FALSE`;
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS private_revealed_at TIMESTAMPTZ`;
    // Operator-archived topics: when set, the topic is excluded from
    // group analytics + the per-topic viewer by default. Distinct from
    // Telegram's is_hidden flag (which mirrors what the Telegram client
    // shows) — this one is for «این تاپیک دیگه مهم نیست / پاک شده».
    await q`ALTER TABLE forum_topics ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`;
    // Operator-written description of what the topic is for. Passed
    // to the v2 analyzer so the LLM can read the context («اینجا فقط
    // تسک‌های pricing هست» / «این تاپیک برای bug-report ها است») and
    // produce more accurate task extraction.
    await q`ALTER TABLE forum_topics ADD COLUMN IF NOT EXISTS notes TEXT`;
    // Group-member roster built up incrementally from chat_member /
    // my_chat_member updates. Telegram Bot API has no "list all
    // members" endpoint; this is how we recover one. status follows
    // the ChatMember enum: "creator" | "administrator" | "member" |
    // "restricted" | "left" | "kicked". last_status_change_at flips
    // every time status changes so we can spot recent leavers.
    await q`
      CREATE TABLE IF NOT EXISTS chat_members (
        chat_id                BIGINT NOT NULL,
        user_id                BIGINT NOT NULL,
        first_name             TEXT,
        last_name              TEXT,
        username               TEXT,
        is_bot                 BOOLEAN NOT NULL DEFAULT FALSE,
        is_premium             BOOLEAN NOT NULL DEFAULT FALSE,
        language_code          TEXT,
        status                 TEXT NOT NULL DEFAULT 'member',
        first_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_status_change_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (chat_id, user_id)
      )`;
    await q`CREATE INDEX IF NOT EXISTS chat_members_chat_status_idx ON chat_members (chat_id, status)`;
    // Site monitors: credentialed web pages the operator wants polled
    // on a Tehran-time schedule. The cron logs in (form POST), loads a
    // target page, AI-analyses the content, and posts notable output to
    // the notes_inbox channel. Credentials are stored here (sensitive).
    await q`
      CREATE TABLE IF NOT EXISTS site_monitors (
        id                 BIGSERIAL PRIMARY KEY,
        name               TEXT NOT NULL,
        login_url          TEXT NOT NULL,
        check_url          TEXT NOT NULL,
        username           TEXT,
        password           TEXT,
        username_field     TEXT NOT NULL DEFAULT 'username',
        password_field     TEXT NOT NULL DEFAULT 'password',
        extra_fields_json  TEXT,
        -- comma-separated Tehran-time hours to run at, e.g. '13,15'
        check_hours_tehran TEXT NOT NULL DEFAULT '13,15',
        -- comma-separated weekday numbers to SKIP (0=Sun..6=Sat).
        -- Default skips Thursday(4) & Friday(5) per the operator.
        skip_weekdays      TEXT NOT NULL DEFAULT '4,5',
        enabled            BOOLEAN NOT NULL DEFAULT TRUE,
        notify_on          TEXT NOT NULL DEFAULT 'change',  -- 'change' | 'always' | 'nonempty'
        last_run_at        TIMESTAMPTZ,
        last_run_slot      TEXT,   -- 'YYYY-MM-DD:HH' Tehran, to dedupe per slot
        last_status        TEXT,   -- 'ok' | 'login_failed' | 'fetch_failed' | 'error'
        last_error         TEXT,
        last_content_hash  TEXT,
        last_content       TEXT,
        last_summary       TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    // fetches the page itself (works for server-rendered sites).
    // 'browser' = a JavaScript SPA the cron can't render; an external
    // GitHub Action runs a real browser, scrapes the text, and POSTs it
    // to /api/site-monitors/ingest. The Vercel cron SKIPS browser-mode
    // monitors (the Action drives them on its own schedule).
    await q`ALTER TABLE site_monitors ADD COLUMN IF NOT EXISTS scrape_mode TEXT NOT NULL DEFAULT 'http'`;
    // Emails received/sent via Resend. Incoming emails (inbound webhook)
    // are stored here and posted to the email_inbox channel with
    // Preview/Summary/Text/HTML inline buttons; the summary/preview
    // pages + reply/compose UI read from this table.
    await q`
      CREATE TABLE IF NOT EXISTS emails (
        id                 BIGSERIAL PRIMARY KEY,
        direction          TEXT NOT NULL,           -- 'in' | 'out'
        resend_id          TEXT,                    -- Resend message id (outgoing) or inbound id
        message_id         TEXT,                    -- RFC Message-ID header
        in_reply_to        TEXT,                    -- Message-ID this replies to
        thread_key         TEXT,                    -- for grouping (references / subject)
        from_email         TEXT,
        from_name          TEXT,
        to_emails          TEXT,                    -- comma-separated
        cc_emails          TEXT,
        subject            TEXT,
        text_body          TEXT,
        html_body          TEXT,
        summary            TEXT,                    -- AI summary (lazy)
        attachments        JSONB,                   -- [{id,filename,contentType,size,...}]
        tg_chat_id         BIGINT,                  -- channel it was posted to
        tg_message_id      BIGINT,                  -- message id in that channel
        status             TEXT,                    -- outgoing: 'sent' | 'failed'
        error              TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE INDEX IF NOT EXISTS emails_created_idx ON emails (created_at DESC)`;
    await q`CREATE INDEX IF NOT EXISTS emails_thread_idx ON emails (thread_key)`;
    await q`ALTER TABLE emails ADD COLUMN IF NOT EXISTS attachments JSONB`;
    // Per-email public link token, STORED rather than derived. It used
    // to be an HMAC of the id under SESSION_SECRET, which meant every
    // link already sent to Telegram silently 401'd the moment that
    // secret was rotated — and nothing surfaced the breakage, because
    // the cards still looked fine. A stored token survives rotation.
    // Backfilled for existing rows; verification still falls back to
    // the old HMAC so links minted before this keep working.
    await q`ALTER TABLE emails ADD COLUMN IF NOT EXISTS public_token TEXT`;
    // sha256() is core Postgres; gen_random_bytes() would need the
    // pgcrypto extension, which we can't assume is installed.
    await q`UPDATE emails
            SET public_token = substr(
              encode(sha256((random()::text || clock_timestamp()::text || id::text)::bytea), 'hex'),
              1, 24)
            WHERE public_token IS NULL`;
    await q`CREATE UNIQUE INDEX IF NOT EXISTS emails_public_token_idx
            ON emails (public_token) WHERE public_token IS NOT NULL`;
    // Multiple email accounts: each has its own Resend API key, from
    // address, inbound token (routes inbound webhooks), and Telegram
    // channel/group where its mail is posted + operated from.
    await q`
      CREATE TABLE IF NOT EXISTS email_accounts (
        id              BIGSERIAL PRIMARY KEY,
        name            TEXT NOT NULL,
        resend_api_key  TEXT,
        from_email      TEXT,
        inbound_token   TEXT UNIQUE,
        tg_channel_id   BIGINT,
        public_url      TEXT,                       -- per-account dashboard base URL for TG buttons
        inbound_domains TEXT,                       -- comma-separated recipient domains that route here
        enabled         BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS public_url TEXT`;
    await q`ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS inbound_domains TEXT`;
    await q`ALTER TABLE emails ADD COLUMN IF NOT EXISTS account_id BIGINT`;
    // Telegram-native reply flow: when the operator taps ↩️ پاسخ on an
    // email card in the group, the bot posts a force-reply prompt and
    // records it here so the operator's reply is matched to the email.
    await q`
      CREATE TABLE IF NOT EXISTS email_pending_replies (
        prompt_chat_id     BIGINT NOT NULL,
        prompt_message_id  BIGINT NOT NULL,
        email_id           BIGINT NOT NULL,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (prompt_chat_id, prompt_message_id)
      )`;
    // SMS dedup: when the same SMS body arrives repeatedly to the
    // same inbox we update one Telegram message in-place instead of
    // posting N copies. body_signature is a whitespace-normalised
    // lowercase hash of the body.
    await q`
      CREATE TABLE IF NOT EXISTS sms_dedup (
        id                   BIGSERIAL PRIMARY KEY,
        inbox_chat_id        BIGINT NOT NULL,
        body_signature       TEXT NOT NULL,
        body_preview         TEXT,
        first_sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        repeat_count         INT NOT NULL DEFAULT 1,
        telegram_message_id  BIGINT,
        UNIQUE (inbox_chat_id, body_signature)
      )`;
    await q`CREATE INDEX IF NOT EXISTS sms_dedup_last_seen_idx
      ON sms_dedup (inbox_chat_id, last_seen_at DESC)`;
    // SMS block list: operator-curated examples of "don't show me
    // this kind again". Each row is one example SMS body; the gate
    // LLM is shown the list and asked "does this new SMS match ANY
    // blocked example?". When the answer is yes the SMS is dropped
    // entirely.
    await q`
      CREATE TABLE IF NOT EXISTS sms_block_rules (
        id            BIGSERIAL PRIMARY KEY,
        example_body  TEXT NOT NULL,
        label         TEXT,
        enabled       BOOLEAN NOT NULL DEFAULT TRUE,
        hit_count     INT NOT NULL DEFAULT 0,
        last_hit_at   TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by    BIGINT
      )`;
    await q`CREATE INDEX IF NOT EXISTS sms_block_rules_enabled_idx
      ON sms_block_rules (enabled) WHERE enabled = TRUE`;
    // SMS accept signatures: once the operator taps "✅ پذیرفتم"
    // under a forwarded SMS, future SMS with the same dedup
    // signature arrive without action buttons — they're approved
    // and the operator doesn't want to see the block/accept
    // question on every repeat.
    await q`
      CREATE TABLE IF NOT EXISTS sms_accept_signatures (
        id              BIGSERIAL PRIMARY KEY,
        body_signature  TEXT NOT NULL UNIQUE,
        body_preview    TEXT,
        hit_count       INT NOT NULL DEFAULT 0,
        last_hit_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by      BIGINT
      )`;
    await q`CREATE INDEX IF NOT EXISTS sms_accept_signatures_sig_idx
      ON sms_accept_signatures (body_signature)`;
    // Secretary Routes: multi-recipient relay layer that sits on top of
    // chat_rules.mode='secretary'. A Route is a named bundle of
    // recipients (chats that receive the forwarded message) plus a
    // list of source chats it covers. When a message arrives in a
    // chat whose mode is 'secretary' AND which is in some enabled
    // Route's source list, the message is fanned out to every
    // recipient. Replies in recipient chats are mapped back to the
    // source via the secretary_relay_links join.
    await q`
      CREATE TABLE IF NOT EXISTS secretary_relays (
        id          BIGSERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        enabled     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`
      CREATE TABLE IF NOT EXISTS secretary_relay_sources (
        relay_id        BIGINT NOT NULL REFERENCES secretary_relays(id) ON DELETE CASCADE,
        source_chat_id  BIGINT NOT NULL,
        source_label    TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (relay_id, source_chat_id)
      )`;
    await q`CREATE INDEX IF NOT EXISTS secretary_relay_sources_chat_idx
      ON secretary_relay_sources (source_chat_id)`;
    await q`
      CREATE TABLE IF NOT EXISTS secretary_relay_recipients (
        relay_id          BIGINT NOT NULL REFERENCES secretary_relays(id) ON DELETE CASCADE,
        recipient_chat_id BIGINT NOT NULL,
        recipient_label   TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (relay_id, recipient_chat_id)
      )`;
    await q`CREATE INDEX IF NOT EXISTS secretary_relay_recipients_chat_idx
      ON secretary_relay_recipients (recipient_chat_id)`;
    await q`
      CREATE TABLE IF NOT EXISTS secretary_relay_links (
        id                     BIGSERIAL PRIMARY KEY,
        relay_id               BIGINT REFERENCES secretary_relays(id) ON DELETE SET NULL,
        business_connection_id TEXT,
        source_chat_id         BIGINT NOT NULL,
        source_message_id      BIGINT,
        recipient_chat_id      BIGINT NOT NULL,
        recipient_message_id   BIGINT NOT NULL,
        direction              TEXT   NOT NULL,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (recipient_chat_id, recipient_message_id)
      )`;
    await q`CREATE INDEX IF NOT EXISTS secretary_relay_links_source_idx
      ON secretary_relay_links (source_chat_id, source_message_id)`;
    // Note watchlist: a small list of "concepts" the operator wants
    // LLM-watched across EVERY incoming message. When the model sees a
    // match in a message, we surface it on /note-watchlist with the
    // quote, save a chat_notes row, and forward to the notes_inbox
    // channel. Concept is the short label ("سفارش جدید", "تأخیر
    // پروازی"); description is free-form guidance for the model.
    await q`
      CREATE TABLE IF NOT EXISTS note_watch_items (
        id              BIGSERIAL PRIMARY KEY,
        concept         TEXT NOT NULL,
        description     TEXT,
        enabled         BOOLEAN NOT NULL DEFAULT TRUE,
        match_count     INT NOT NULL DEFAULT 0,
        last_matched_at TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`
      CREATE TABLE IF NOT EXISTS note_watch_matches (
        id              BIGSERIAL PRIMARY KEY,
        item_id         BIGINT NOT NULL REFERENCES note_watch_items(id) ON DELETE CASCADE,
        chat_id         BIGINT NOT NULL,
        chat_title      TEXT,
        message_log_id  BIGINT,
        source_message_id BIGINT,
        sender_name     TEXT,
        quote           TEXT NOT NULL,
        reason          TEXT,
        forwarded_to    BIGINT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE INDEX IF NOT EXISTS note_watch_matches_item_idx
      ON note_watch_matches (item_id, created_at DESC)`;
    await q`CREATE INDEX IF NOT EXISTS note_watch_matches_chat_idx
      ON note_watch_matches (chat_id, created_at DESC)`;
    // The "🚩 گزارش خطا" button under a notes_inbox notice stamps
    // this column so the dashboard can flag the row + the scanner
    // can learn to be more conservative on similar text later.
    // The "✅ تأیید" button stamps confirmed_at for the opposite
    // signal — the operator says this match was correct.
    await q`ALTER TABLE note_watch_matches ADD COLUMN IF NOT EXISTS reported_wrong_at TIMESTAMPTZ`;
    await q`ALTER TABLE note_watch_matches ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ`;
    // Dynamic per-concept aliases. One concept ("کنسرت امیر بال")
    // can have many alias rows ("Amir Bal", "اجرای امیر", "کنسرت
    // برج میلاد") — the LLM sees the full list when scanning so it
    // can detect the concept even when phrased indirectly.
    await q`
      CREATE TABLE IF NOT EXISTS note_watch_aliases (
        id          BIGSERIAL PRIMARY KEY,
        item_id     BIGINT NOT NULL REFERENCES note_watch_items(id) ON DELETE CASCADE,
        alias       TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (item_id, alias)
      )`;
    await q`CREATE INDEX IF NOT EXISTS note_watch_aliases_item_idx
      ON note_watch_aliases (item_id)`;
    // Per-concept advanced knobs. emoji is a visual prefix shown on
    // the dashboard chip and inside the notes_inbox notice. priority
    // is low|normal|high — high adds 🚨 to the notice and (later) can
    // gate fire-alert. forward_to_inbox is a per-concept override of
    // the global notesWatchlistForwardToInbox flag. cooldown_override
    // overrides the global minutes-between-matches setting for this
    // concept only.
    await q`ALTER TABLE note_watch_items ADD COLUMN IF NOT EXISTS emoji TEXT`;
    await q`ALTER TABLE note_watch_items ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'`;
    await q`ALTER TABLE note_watch_items ADD COLUMN IF NOT EXISTS forward_to_inbox BOOLEAN NOT NULL DEFAULT TRUE`;
    await q`ALTER TABLE note_watch_items ADD COLUMN IF NOT EXISTS cooldown_override_minutes INT`;
    // Scope / context filter: operator describes the domain the
    // concept lives in (e.g. "music / singer / concert / album /
    // performance") so the scanner can drop common-name false
    // positives. A message that mentions "آرمان" in a daily-life
    // context doesn't match a "آرمان گرشاسبی" concept whose context
    // is "music"; the message must contain BOTH the alias AND a
    // signal that it's in that context for the match to fire.
    await q`ALTER TABLE note_watch_items ADD COLUMN IF NOT EXISTS context TEXT`;
    // Group analytics: cache the full task-lifecycle analysis per
    // (chat, window-days) so the public share link can serve it
    // instantly without paying for an LLM call. Also stores a
    // share_token at the chat level so the operator can hand out a
    // read-only URL.
    await q`
      CREATE TABLE IF NOT EXISTS group_analytics (
        id          BIGSERIAL PRIMARY KEY,
        chat_id     BIGINT NOT NULL,
        chat_title  TEXT,
        window_days INT NOT NULL,
        since_iso   TEXT NOT NULL,
        message_count INT NOT NULL,
        analysis    JSONB NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (chat_id, window_days)
      )`;
    await q`CREATE INDEX IF NOT EXISTS group_analytics_chat_idx
      ON group_analytics (chat_id, created_at DESC)`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS analytics_share_token TEXT`;
    // Shared access code for the editable /board/<token> — required to
    // view or edit (no anonymous access). Set by the operator.
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS board_code TEXT`;
    // Optional per-board overrides: custom column set (JSON) and a custom
    // AI categorisation prompt. NULL = use defaults.
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS board_columns TEXT`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS board_prompt TEXT`;
    // Configurable label palette + priority levels for the board (JSON).
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS board_labels TEXT`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS board_priorities TEXT`;
    await q`CREATE UNIQUE INDEX IF NOT EXISTS chat_rules_share_token_idx
      ON chat_rules (analytics_share_token) WHERE analytics_share_token IS NOT NULL`;
    // Per-chat summary cadence: how many hours back the daily-summary
    // cron looks at for THIS chat. NULL means "use the cron default
    // (24h)". Lets the operator pick a tighter window for a high-
    // velocity group.
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS summary_interval_hours INT`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS last_summary_run_at TIMESTAMPTZ`;
    // AI-extracted OTP / verification code surfaced inline on every
    // message that carried one. Populated by maybeExtractOtp in
    // bot.ts (background, fire-and-forget). Dashboard renders a
    // tap-to-copy chip when set.
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS otp_code TEXT`;
    // Phone → Telegram identity harvested from "contact" messages
    // (customer taps Share Contact, or anyone forwards a vCard). We
    // store the last 9-10 digits as the lookup key because incoming
    // SMS messages from gateways may or may not carry the country
    // code; the tail still uniquely identifies the line.
    await q`
      CREATE TABLE IF NOT EXISTS phone_contacts (
        id                BIGSERIAL PRIMARY KEY,
        phone_full        TEXT NOT NULL,
        phone_tail        TEXT NOT NULL,
        telegram_user_id  BIGINT,
        first_name        TEXT,
        last_name         TEXT,
        username          TEXT,
        source            TEXT NOT NULL DEFAULT 'contact_share',
        observed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE INDEX IF NOT EXISTS phone_contacts_tail_idx ON phone_contacts (phone_tail)`;
    await q`CREATE INDEX IF NOT EXISTS phone_contacts_user_idx ON phone_contacts (telegram_user_id) WHERE telegram_user_id IS NOT NULL`;
    // When the user asks "send me a photo of you", the AI uses the
    // operator's reference photo (settings.ownerPhotoUrl) as visual
    // anchor and calls an image-gen model. Off by default — costs ~$0.04
    // per generation and we don't want surprise charges.
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS ai_generate_photo BOOLEAN NOT NULL DEFAULT FALSE`;
    // Per-chat "function": some chats aren't ordinary conversations,
    // they're tools (e.g. a downloader bot, an SMS-forwarding channel,
    // a news source). Labelling them lets the bot adjust classifier
    // importance, route requests to them, and group them in the UI.
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS function_role TEXT`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS function_config JSONB`;
    await q`CREATE INDEX IF NOT EXISTS chat_rules_function_role_idx ON chat_rules (function_role) WHERE function_role IS NOT NULL`;
    // Auto-summary: when a chat is in ai_listen and a thread closes
    // (no new message for `auto_summarize_gap_minutes`), post a
    // summary into the configured summary_inbox channel.
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS auto_summarize_enabled BOOLEAN NOT NULL DEFAULT FALSE`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS auto_summarize_gap_minutes INT NOT NULL DEFAULT 5`;
    // Smart timing: only summarize when the last message in the pending
    // burst is from the *initiator* (the person who fired off the first
    // message after the previous summary), and measure the gap from that
    // person's last message. Without it, we just wait for any pause where
    // the other person sent last. Default ON so new chats inherit it.
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS auto_summarize_smart_timing BOOLEAN NOT NULL DEFAULT TRUE`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS last_auto_summary_at TIMESTAMPTZ`;
    // Per-chat media-routing toggles. When ON, any incoming voice /
    // video / photo / location is auto-copied to the corresponding
    // *_storage role chat. Voice / video-note copies include a 📝
    // Transcribe inline button. auto_extract_notes runs an AI pass
    // that pulls addresses / locations / contacts into chat_notes.
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS auto_forward_voice BOOLEAN NOT NULL DEFAULT FALSE`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS auto_forward_video BOOLEAN NOT NULL DEFAULT FALSE`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS auto_forward_photo BOOLEAN NOT NULL DEFAULT FALSE`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS auto_forward_location BOOLEAN NOT NULL DEFAULT FALSE`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS auto_extract_notes BOOLEAN NOT NULL DEFAULT FALSE`;
    // Owner's OWN voice notes, transcribed straight back under the
    // voice as a plain reply. Per-chat because it's a habit, not a
    // global preference: you want it in the chats where you dictate,
    // not in every DM you ever open.
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS self_voice_transcript BOOLEAN NOT NULL DEFAULT FALSE`;
    // Follow-up reminders: when ON, a cron tick checks whether the
    // owner has left this person hanging — if there's a non-owner
    // message that's older than threshold_hours with no owner reply
    // since, drop a notice into notes_inbox with a summary of the
    // pending messages. Default ON for all chats (operator can opt
    // out per-chat), default threshold 2h. A second ping fires after
    // ESCALATE_HOURS more silence (default 12h).
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_enabled BOOLEAN NOT NULL DEFAULT TRUE`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_threshold_hours NUMERIC NOT NULL DEFAULT 2`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_escalate_hours NUMERIC NOT NULL DEFAULT 12`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_last_ping_at TIMESTAMPTZ`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_last_ping_kind TEXT`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_acked_at TIMESTAMPTZ`;
    // Cached AI verdict. The cron uses AI to decide whether the
    // operator needs to reply (vs. the customer's message is a natural
    // conversation closer like "thanks" / "ok"). Cached against the
    // last customer message timestamp — when a new customer message
    // arrives, the cache is implicitly invalidated.
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_ai_for_message_at TIMESTAMPTZ`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_ai_verdict_at TIMESTAMPTZ`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_ai_needs_reply BOOLEAN`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_ai_reason TEXT`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_ai_urgency TEXT`;
    // Per-chat opt-in to transcribe voice messages before sending the
    // conversation to the AI follow-up judge. Costs an STT call per
    // voice in the recent window — default OFF so it's only paid for
    // chats the operator really cares about.
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_transcribe_voices BOOLEAN NOT NULL DEFAULT FALSE`;
    // Chat profiles: shared template of follow-up settings. A chat
    // can be assigned to a profile and inherit its values. Useful
    // for batching "all my work contacts → ping after 1h, transcribe
    // voices" without configuring each chat individually.
    await q`
      CREATE TABLE IF NOT EXISTS chat_profiles (
        id                          SERIAL PRIMARY KEY,
        slug                        TEXT NOT NULL,
        name                        TEXT NOT NULL,
        emoji                       TEXT,
        description                 TEXT,
        is_default                  BOOLEAN NOT NULL DEFAULT FALSE,
        is_builtin                  BOOLEAN NOT NULL DEFAULT FALSE,
        follow_up_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
        follow_up_threshold_hours   NUMERIC NOT NULL DEFAULT 2,
        follow_up_escalate_hours    NUMERIC NOT NULL DEFAULT 12,
        follow_up_transcribe_voices BOOLEAN NOT NULL DEFAULT FALSE,
        tenant_id                   BIGINT,
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tenant_id, slug)
      )`;
    await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS profile_id INTEGER`;
    await q`CREATE INDEX IF NOT EXISTS chat_rules_profile_idx
      ON chat_rules (profile_id) WHERE profile_id IS NOT NULL`;
    // Expand chat_profiles to hold ALL of the per-chat settings the
    // operator can edit on /chats/[id]. Each new column is nullable
    // so existing rows keep working; resolution rule is COALESCE
    // (profile, chat, fallback) wherever settings are read.
    await q`ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS mode TEXT`;
    await q`ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS vip BOOLEAN`;
    await q`ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS muted BOOLEAN`;
    await q`ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS auto_summarize_enabled BOOLEAN`;
    await q`ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS auto_summarize_gap_minutes INTEGER`;
    await q`ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS auto_summarize_smart_timing BOOLEAN`;
    await q`ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS auto_forward_voice BOOLEAN`;
    await q`ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS auto_forward_video BOOLEAN`;
    await q`ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS auto_forward_photo BOOLEAN`;
    await q`ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS auto_forward_location BOOLEAN`;
    await q`ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS auto_extract_notes BOOLEAN`;
    await q`ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS ai_process_voice BOOLEAN`;
    await q`ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS ai_process_stickers BOOLEAN`;
    await q`ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS ai_process_gifs BOOLEAN`;
    await q`ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS ai_process_photos BOOLEAN`;
    await q`ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS ai_process_video_notes BOOLEAN`;
    // Seed builtin profiles per-tenant (idempotent — ON CONFLICT
    // skips if the (tenant_id, slug) row already exists).
    const tenantRows = await q`SELECT id FROM tenants`;
    for (const tr of tenantRows as Array<{ id: string | number }>) {
      const tid = Number(tr.id);
      const seeds = [
        {
          slug: "default",
          name: "پیش‌فرض",
          emoji: "📋",
          isDefault: true,
          enabled: true,
          threshold: 2,
          escalate: 12,
          transcribe: false,
        },
        {
          slug: "work",
          name: "کاری",
          emoji: "💼",
          isDefault: false,
          enabled: true,
          threshold: 1,
          escalate: 4,
          transcribe: true,
        },
        {
          slug: "friend",
          name: "دوستانه",
          emoji: "😊",
          isDefault: false,
          enabled: true,
          threshold: 4,
          escalate: 24,
          transcribe: false,
        },
        {
          slug: "intimate",
          name: "صمیمی",
          emoji: "❤️",
          isDefault: false,
          enabled: true,
          threshold: 0.5,
          escalate: 2,
          transcribe: true,
        },
        {
          slug: "quick",
          name: "پاسخ سریع",
          emoji: "⚡",
          isDefault: false,
          enabled: true,
          threshold: 0.25,
          escalate: 1,
          transcribe: true,
        },
      ];
      for (const s of seeds) {
        await q`
          INSERT INTO chat_profiles (
            slug, name, emoji, is_default, is_builtin,
            follow_up_enabled, follow_up_threshold_hours,
            follow_up_escalate_hours, follow_up_transcribe_voices,
            tenant_id
          )
          VALUES (
            ${s.slug}, ${s.name}, ${s.emoji}, ${s.isDefault}, TRUE,
            ${s.enabled}, ${s.threshold}, ${s.escalate}, ${s.transcribe},
            ${tid}
          )
          ON CONFLICT (tenant_id, slug) DO NOTHING`;
      }
    }
    // Reactions count as "the owner replied" for the follow-up cron.
    // We can't store reactions in messages_log because logMessage dedupes
    // on (bcId, chat_id, message_id) and that key already belongs to the
    // customer's message that got reacted to. Keep them in their own
    // table and UNION into the per-chat aggregation.
    await q`
      CREATE TABLE IF NOT EXISTS owner_reactions (
        id                     BIGSERIAL PRIMARY KEY,
        chat_id                BIGINT NOT NULL,
        business_connection_id TEXT,
        message_id             BIGINT NOT NULL,
        emojis                 TEXT,
        tenant_id              BIGINT,
        reacted_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE UNIQUE INDEX IF NOT EXISTS owner_reactions_unique_idx
      ON owner_reactions (chat_id, COALESCE(business_connection_id, ''), message_id)`;
    await q`CREATE INDEX IF NOT EXISTS owner_reactions_chat_time_idx
      ON owner_reactions (chat_id, reacted_at DESC)`;
    // Multi-role per chat. The legacy chat_rules.function_role is
    // kept for backwards compat; new code reads from chat_function_roles.
    // A chat can carry several roles at once — e.g. the same channel
    // can be both a Storage AND a Notes inbox.
    await q`
      CREATE TABLE IF NOT EXISTS chat_function_roles (
        chat_id     BIGINT NOT NULL,
        role        TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (chat_id, role)
      )`;
    // Debug log: prefers Redis (1-hour TTL list); when Redis isn't
    // configured we fall back to this minimal table — same 1-hour
    // window, opportunistic cleanup on every Nth write. No indexes
    // beyond received_at since the table never grows past ~2k rows.
    await q`
      CREATE TABLE IF NOT EXISTS telegram_debug_log (
        id           BIGSERIAL PRIMARY KEY,
        received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        update_type  TEXT NOT NULL,
        chat_id      BIGINT,
        chat_type    TEXT,
        user_id      BIGINT,
        bc_id        TEXT,
        preview      TEXT,
        payload      JSONB NOT NULL
      )`;
    await q`CREATE INDEX IF NOT EXISTS telegram_debug_log_received_idx
      ON telegram_debug_log (received_at DESC)`;
    await q`CREATE INDEX IF NOT EXISTS chat_function_roles_role_idx ON chat_function_roles (role)`;
    // Optional category per (chat_id, role) so operator can group
    // their function assignments into "personal", "work", "shared",
    // etc. — default categories are auto-seeded; user can add more.
    await q`ALTER TABLE chat_function_roles ADD COLUMN IF NOT EXISTS category TEXT`;
    await q`
      CREATE TABLE IF NOT EXISTS function_categories (
        slug        TEXT PRIMARY KEY,
        label       TEXT NOT NULL,
        emoji       TEXT,
        sort_order  INT NOT NULL DEFAULT 100,
        is_builtin  BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    {
      const flag = await q`SELECT value FROM settings WHERE key = 'migration.function_categories_seed.v1'`;
      if ((flag as unknown[]).length === 0) {
        await q`INSERT INTO function_categories (slug, label, emoji, sort_order, is_builtin) VALUES
          ('default', 'پیش‌فرض', '⭐', 10, TRUE),
          ('personal', 'شخصی', '👤', 20, TRUE),
          ('work', 'کاری', '💼', 30, TRUE),
          ('media', 'مدیا', '🎬', 40, TRUE),
          ('archive', 'آرشیو', '🗄', 50, TRUE)
          ON CONFLICT (slug) DO NOTHING`;
        await q`INSERT INTO settings (key, value) VALUES ('migration.function_categories_seed.v1', 'done')
                ON CONFLICT (key) DO NOTHING`;
      }
    }
    // One-time backfill: copy the single function_role into the
    // junction table so existing rules keep working under the
    // multi-role read path.
    {
      const flag = await q`SELECT value FROM settings WHERE key = 'migration.chat_function_roles_backfill.v1'`;
      if ((flag as unknown[]).length === 0) {
        await q`
          INSERT INTO chat_function_roles (chat_id, role)
          SELECT chat_id, function_role
          FROM chat_rules
          WHERE function_role IS NOT NULL
          ON CONFLICT (chat_id, role) DO NOTHING`;
        await q`INSERT INTO settings (key, value) VALUES ('migration.chat_function_roles_backfill.v1', 'done')
                ON CONFLICT (key) DO NOTHING`;
      }
    }
    // One-time correction: earlier code in setChatAutomation /
    // setChatFunctionRoles defaulted chat_type to 'private' on
    // first-write — which is wrong for channels (negative chat_ids).
    // Pull the right type from messages_log when we have history;
    // otherwise guess from the sign of chat_id (negative → supergroup).
    {
      const flag = await q`SELECT value FROM settings WHERE key = 'migration.chat_type_correction.v1'`;
      if ((flag as unknown[]).length === 0) {
        await q`
          UPDATE chat_rules r
          SET chat_type = COALESCE(
            (SELECT chat_type FROM messages_log WHERE chat_id = r.chat_id LIMIT 1),
            CASE WHEN r.chat_id < 0 THEN 'supergroup' ELSE 'private' END
          )
          WHERE r.chat_type = 'private' AND r.chat_id < 0`;
        await q`INSERT INTO settings (key, value) VALUES ('migration.chat_type_correction.v1', 'done')
                ON CONFLICT (key) DO NOTHING`;
      }
    }
    // v2: broader correction. v1 only fixed "negative chat_id stamped
    // as private". Several setters (setAutoSummarize, setChatBot, the
    // /api/chats/[id] PUT) silently passed 'private' or 'channel' as a
    // fallback when bootstrapping a row from no history, and could
    // also flip a positive-id chat to a group/channel type via stale
    // form data. Re-sync chat_rules.chat_type from messages_log
    // whenever there's a recorded mismatch.
    {
      const flag = await q`SELECT value FROM settings WHERE key = 'migration.chat_type_correction.v2'`;
      if ((flag as unknown[]).length === 0) {
        await q`
          UPDATE chat_rules r
          SET chat_type = src.chat_type
          FROM (
            SELECT chat_id, MAX(chat_type) AS chat_type
            FROM messages_log
            GROUP BY chat_id
          ) src
          WHERE src.chat_id = r.chat_id
            AND src.chat_type IS NOT NULL
            AND src.chat_type <> r.chat_type
            AND src.chat_type IN ('private', 'group', 'supergroup', 'channel')`;
        // Belt-and-braces: any row with no messages_log history at all
        // gets its chat_type aligned with the chat_id sign — positive
        // is always a DM, negative is always a group/channel.
        await q`
          UPDATE chat_rules r
          SET chat_type = CASE
                            WHEN r.chat_id < 0 AND r.chat_type = 'private' THEN 'supergroup'
                            WHEN r.chat_id > 0 AND r.chat_type IN ('group', 'supergroup', 'channel') THEN 'private'
                            ELSE r.chat_type
                          END
          WHERE NOT EXISTS (
            SELECT 1 FROM messages_log m WHERE m.chat_id = r.chat_id
          )`;
        await q`INSERT INTO settings (key, value) VALUES ('migration.chat_type_correction.v2', 'done')
                ON CONFLICT (key) DO NOTHING`;
      }
    }
    // Per-chat notes — addresses, locations, contacts, key points.
    // kind is one of: address|location|contact|note|date|phone|url.
    // source_message_id links back to the original message in
    // messages_log when known.
    await q`
      CREATE TABLE IF NOT EXISTS chat_notes (
        id                BIGSERIAL PRIMARY KEY,
        chat_id           BIGINT NOT NULL,
        tenant_id         BIGINT,
        source_message_id BIGINT,
        kind              TEXT NOT NULL,
        title             TEXT,
        content           TEXT NOT NULL,
        metadata          JSONB,
        sender_name       TEXT,
        archived_at       TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE INDEX IF NOT EXISTS chat_notes_chat_idx ON chat_notes (chat_id, created_at DESC)`;
    await q`CREATE INDEX IF NOT EXISTS chat_notes_tenant_idx ON chat_notes (tenant_id, created_at DESC) WHERE tenant_id IS NOT NULL`;
    await q`CREATE INDEX IF NOT EXISTS chat_notes_kind_idx ON chat_notes (kind, created_at DESC)`;
    // Tracks each copy we sent to a *_storage chat — used by the
    // 📝 Transcribe inline button to find the original voice/video
    // file id without stuffing it into callback_data (which is
    // limited to 64 bytes).
    await q`
      CREATE TABLE IF NOT EXISTS media_router_messages (
        storage_chat_id    BIGINT NOT NULL,
        storage_message_id BIGINT NOT NULL,
        file_id            TEXT NOT NULL,
        kind               TEXT NOT NULL,
        source_chat_id     BIGINT,
        source_message_id  BIGINT,
        source_sender_name TEXT,
        tenant_id          BIGINT,
        transcript         TEXT,
        transcribed_at     TIMESTAMPTZ,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (storage_chat_id, storage_message_id)
      )`;
    await q`CREATE INDEX IF NOT EXISTS media_router_messages_source_idx ON media_router_messages (source_chat_id, source_message_id)`;
    // Debug log for the media-router. One row per routing decision
    // (routed / skipped because flag off / skipped because muted /
    // no target / error). Lets the operator see WHY a voice didn't
    // land in the voice_storage channel when it should have.
    await q`
      CREATE TABLE IF NOT EXISTS media_routing_log (
        id                 BIGSERIAL PRIMARY KEY,
        source_chat_id     BIGINT NOT NULL,
        source_message_id  BIGINT,
        kind               TEXT NOT NULL,
        decision           TEXT NOT NULL,
        target_role        TEXT,
        target_chat_id     BIGINT,
        target_message_id  BIGINT,
        error              TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE INDEX IF NOT EXISTS media_routing_log_created_idx ON media_routing_log (created_at DESC)`;
    await q`CREATE INDEX IF NOT EXISTS media_routing_log_source_idx ON media_routing_log (source_chat_id, created_at DESC)`;
    // Persisted per-thread AI summaries so the dashboard doesn't lose
    // them on reload and so we can detect when a thread has new
    // activity that arrived after the last summary.
    await q`
      CREATE TABLE IF NOT EXISTS thread_summaries (
        id                BIGSERIAL PRIMARY KEY,
        chat_id           BIGINT NOT NULL,
        thread_started_at TIMESTAMPTZ NOT NULL,
        thread_ended_at   TIMESTAMPTZ NOT NULL,
        message_count     INT NOT NULL,
        summary           TEXT NOT NULL,
        topics            JSONB NOT NULL DEFAULT '[]',
        action_items      JSONB NOT NULL DEFAULT '[]',
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (chat_id, thread_started_at)
      )`;
    await q`CREATE INDEX IF NOT EXISTS thread_summaries_chat_idx ON thread_summaries (chat_id, thread_started_at DESC)`;
    // Where we posted this summary (so owner replying in the inbox
    // can be forwarded back to the source chat).
    await q`ALTER TABLE thread_summaries ADD COLUMN IF NOT EXISTS inbox_chat_id BIGINT`;
    await q`ALTER TABLE thread_summaries ADD COLUMN IF NOT EXISTS inbox_message_id BIGINT`;
    await q`CREATE INDEX IF NOT EXISTS thread_summaries_inbox_idx ON thread_summaries (inbox_chat_id, inbox_message_id) WHERE inbox_chat_id IS NOT NULL`;
    // Ask queries — saved natural-language Q&A so the owner can
    // revisit old answers without re-paying for the AI call. The
    // page also re-uses recent answers within a short TTL.
    await q`
      CREATE TABLE IF NOT EXISTS ask_queries (
        id                 BIGSERIAL PRIMARY KEY,
        prompt             TEXT NOT NULL,
        prompt_hash        TEXT NOT NULL,
        answer             TEXT NOT NULL,
        scanned_messages   INT NOT NULL,
        days               INT NOT NULL,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by         BIGINT
      )`;
    await q`CREATE INDEX IF NOT EXISTS ask_queries_created_idx ON ask_queries (created_at DESC)`;
    await q`CREATE INDEX IF NOT EXISTS ask_queries_hash_idx ON ask_queries (prompt_hash, created_at DESC)`;
    // Instagram (and future platforms) story-monitor list. Each row
    // is one account to poll periodically; events table records
    // every detected story so we don't forward duplicates.
    await q`
      CREATE TABLE IF NOT EXISTS monitored_accounts (
        id              BIGSERIAL PRIMARY KEY,
        platform        TEXT NOT NULL DEFAULT 'instagram',
        username        TEXT NOT NULL,
        url             TEXT,
        external_id     TEXT,
        topic_id        TEXT,
        enabled         BOOLEAN NOT NULL DEFAULT TRUE,
        last_checked_at TIMESTAMPTZ,
        last_story_at   TIMESTAMPTZ,
        last_error      TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (platform, username)
      )`;
    await q`CREATE INDEX IF NOT EXISTS monitored_accounts_enabled_idx ON monitored_accounts (enabled, last_checked_at NULLS FIRST)`;
    await q`ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS check_stories BOOLEAN NOT NULL DEFAULT TRUE`;
    await q`ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS check_posts BOOLEAN NOT NULL DEFAULT FALSE`;
    await q`ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS check_reels BOOLEAN NOT NULL DEFAULT FALSE`;
    await q`ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS check_profile BOOLEAN NOT NULL DEFAULT FALSE`;
    await q`ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS check_mentioned BOOLEAN NOT NULL DEFAULT FALSE`;
    await q`ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS interval_minutes INT NOT NULL DEFAULT 30`;
    // One-shot migration: when the operator switched the dashboard
    // to only offer 3h / 6h / 12h / 24h / notify, any account still
    // sitting on a legacy sub-3h value (5 / 10 / 15 / 30 / 60 / 120)
    // would still be polled every N minutes by the cron and break
    // the cost-predictability guarantee — there's a 30-min row
    // visible in a recent screenshot pulling $5.76/month on its
    // own. Bump every such row up to 12h (the new default). Idempotent
    // via the settings flag so we don't overwrite an operator's
    // future legitimate manual change.
    {
      const flag = await q`SELECT value FROM settings WHERE key = 'migration.monitored_3h_floor.v1'`;
      if ((flag as unknown[]).length === 0) {
        await q`UPDATE monitored_accounts SET interval_minutes = 720
                WHERE interval_minutes < 180`;
        await q`INSERT INTO settings (key, value) VALUES ('migration.monitored_3h_floor.v1', 'done')
                ON CONFLICT (key) DO NOTHING`;
      }
    }
    await q`ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS instagram_user_id TEXT`;
    await q`ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS full_name TEXT`;
    // Optimization snapshot: media_count from cheap user-info call.
    // If unchanged between two ticks → skip the expensive posts /
    // reels / mentioned fetches entirely. Saves ~4× the cost on
    // accounts that don't post often (most accounts).
    await q`ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS last_media_count INT`;
    // Notify mode: instead of polling on a fixed clock, the cron
    // skips this account and waits for an external /api/insta-webhook
    // to fire. mode = 'interval' (default, current behaviour) or
    // 'notify'. last_notify_at tracks the most recent inbound
    // webhook so we can enforce a 3-hour cooldown between
    // notify-triggered fetches. pending_fetch_at holds the next
    // scheduled fetch when we deferred (because of the cooldown OR
    // the 02-08 quiet window); cron checks this column too.
    // pending_notify_kinds is the JSON array of "actions" the
    // operator's notify service asked for ('story' / 'post' /
    // 'reel' / 'mentioned' / 'profile' / 'any').
    await q`ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'interval'`;
    await q`ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS last_notify_at TIMESTAMPTZ`;
    await q`ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS pending_fetch_at TIMESTAMPTZ`;
    await q`ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS pending_notify_kinds JSONB`;
    await q`CREATE INDEX IF NOT EXISTS monitored_accounts_pending_idx
      ON monitored_accounts (pending_fetch_at)
      WHERE pending_fetch_at IS NOT NULL`;
    await q`ALTER TABLE monitor_events ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'story'`;
    await q`ALTER TABLE monitor_events ADD COLUMN IF NOT EXISTS caption TEXT`;
    await q`ALTER TABLE monitor_events ADD COLUMN IF NOT EXISTS media_type TEXT`;
    await q`
      CREATE TABLE IF NOT EXISTS monitor_events (
        id              BIGSERIAL PRIMARY KEY,
        account_id      BIGINT NOT NULL REFERENCES monitored_accounts(id) ON DELETE CASCADE,
        story_id        TEXT,
        story_url       TEXT,
        detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        forwarded_chat_id BIGINT,
        forwarded_message_id BIGINT,
        forwarded_at    TIMESTAMPTZ,
        status          TEXT NOT NULL DEFAULT 'detected',
        error           TEXT,
        UNIQUE (account_id, story_id)
      )`;
    await q`CREATE INDEX IF NOT EXISTS monitor_events_account_idx ON monitor_events (account_id, detected_at DESC)`;
    await q`CREATE INDEX IF NOT EXISTS monitor_events_detected_idx ON monitor_events (detected_at DESC)`;
    // One-time migration: the old default was 'secretary' which caused the
    // bot to relay/auto-reply in every new chat. Owner wants the default to
    // be silent (off); flip every existing 'secretary' row to 'off' exactly
    // once, then leave them alone so future explicit choices stick.
    {
      const flag = await q`SELECT value FROM settings WHERE key = 'migration.default_mode_off.v1'`;
      if ((flag as unknown[]).length === 0) {
        await q`UPDATE chat_rules SET mode = 'off', mode_changed_at = NOW() WHERE mode = 'secretary'`;
        await q`INSERT INTO settings (key, value) VALUES ('migration.default_mode_off.v1', 'done')
                ON CONFLICT (key) DO NOTHING`;
      }
    }
    // One-time migration: seed the HikerAPI key override + name from
    // chat so the owner doesn't have to update Vercel env vars and
    // redeploy just to rotate the key. They can override later via
    // the 🔑 button on /monitored. We INSERT-only (won't clobber an
    // existing value), and we use a migration flag so this runs once.
    {
      const flag = await q`SELECT value FROM settings WHERE key = 'migration.hiker_smmr_seed.v1'`;
      if ((flag as unknown[]).length === 0) {
        await q`INSERT INTO settings (key, value) VALUES ('hikerApiKeyOverride', 'yuoyucbbl5ogndg5ur4abeovv2hjrwnv')
                ON CONFLICT (key) DO NOTHING`;
        await q`INSERT INTO settings (key, value) VALUES ('hikerApiKeyName', 'smmr')
                ON CONFLICT (key) DO NOTHING`;
        await q`INSERT INTO settings (key, value) VALUES ('migration.hiker_smmr_seed.v1', 'done')
                ON CONFLICT (key) DO NOTHING`;
      }
    }
    // One-time migration: previously, bot-echoed business messages (the
    // AI / auto / friendly replies that Telegram bounces back as
    // business_message with sender_business_bot set) were logged with
    // from_owner=TRUE and source=NULL — which made `lastOwnerMessageAt`
    // treat the bot's own reply as the owner being "active" and silenced
    // any further response via the grace window. Backfill those rows
    // with source='bot_echo' so the grace check ignores them.
    {
      const flag = await q`SELECT value FROM settings WHERE key = 'migration.bot_echo_source.v1'`;
      if ((flag as unknown[]).length === 0) {
        await q`UPDATE messages_log SET source = 'bot_echo'
                WHERE from_owner = TRUE
                  AND source IS NULL
                  AND reason = 'bot outgoing (business)'`;
        await q`INSERT INTO settings (key, value) VALUES ('migration.bot_echo_source.v1', 'done')
                ON CONFLICT (key) DO NOTHING`;
      }
    }
    await q`
      CREATE TABLE IF NOT EXISTS ai_usage (
        id                     BIGSERIAL PRIMARY KEY,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        chat_id                BIGINT,
        business_connection_id TEXT,
        model                  TEXT NOT NULL,
        purpose                TEXT NOT NULL,
        prompt_tokens          INT NOT NULL DEFAULT 0,
        completion_tokens      INT NOT NULL DEFAULT 0,
        total_tokens           INT NOT NULL DEFAULT 0,
        cost_usd               NUMERIC(12, 6) NOT NULL DEFAULT 0
      )`;
    await q`CREATE INDEX IF NOT EXISTS ai_usage_chat_idx ON ai_usage (chat_id, created_at DESC)`;
    await q`CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage (created_at DESC)`;
    // HikerAPI per-call cost log. HikerAPI itself doesn't expose
    // dollar-level usage to us so we estimate from a configurable
    // per-endpoint table and sum locally. Every paid call inserts
    // one row; getUsage / auth probes record cost_usd=0.
    await q`
      CREATE TABLE IF NOT EXISTS hikerapi_usage (
        id          BIGSERIAL PRIMARY KEY,
        called_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        endpoint    TEXT NOT NULL,
        cost_usd    NUMERIC(10, 6) NOT NULL DEFAULT 0,
        account_id  BIGINT
      )`;
    await q`CREATE INDEX IF NOT EXISTS hikerapi_usage_called_idx ON hikerapi_usage (called_at DESC)`;
    await q`CREATE INDEX IF NOT EXISTS hikerapi_usage_account_idx ON hikerapi_usage (account_id, called_at DESC) WHERE account_id IS NOT NULL`;
    await q`
      CREATE TABLE IF NOT EXISTS extracted_items (
        id           BIGSERIAL PRIMARY KEY,
        message_id   BIGINT,
        chat_id      BIGINT,
        chat_title   TEXT,
        sender_name  TEXT,
        kind         TEXT NOT NULL,
        title        TEXT NOT NULL,
        description  TEXT,
        due_at       TIMESTAMPTZ,
        location     TEXT,
        participants JSONB,
        done_at      TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE INDEX IF NOT EXISTS extracted_items_due_idx ON extracted_items (due_at) WHERE done_at IS NULL`;
    await q`CREATE INDEX IF NOT EXISTS extracted_items_created_idx ON extracted_items (created_at DESC)`;
    await q`ALTER TABLE extracted_items ADD COLUMN IF NOT EXISTS source_text TEXT`;
    await q`ALTER TABLE extracted_items ADD COLUMN IF NOT EXISTS tg_message_id BIGINT`;
    await q`ALTER TABLE extracted_items ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'`;
    await q`CREATE INDEX IF NOT EXISTS extracted_items_priority_idx ON extracted_items (priority, created_at DESC)`;
    await q`
      CREATE TABLE IF NOT EXISTS invites (
        token        TEXT PRIMARY KEY,
        purpose      TEXT NOT NULL,
        payload      JSONB NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at   TIMESTAMPTZ NOT NULL,
        used_at      TIMESTAMPTZ,
        used_by      BIGINT,
        created_by   BIGINT
      )`;
    await q`CREATE INDEX IF NOT EXISTS invites_expires_idx ON invites (expires_at)`;
    await q`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id          BIGSERIAL PRIMARY KEY,
        title       TEXT NOT NULL,
        aliases     JSONB NOT NULL DEFAULT '[]',
        body        TEXT NOT NULL,
        tags        JSONB NOT NULL DEFAULT '[]',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by  BIGINT
      )`;
    await q`CREATE INDEX IF NOT EXISTS knowledge_entries_title_idx ON knowledge_entries (lower(title))`;
    await q`CREATE INDEX IF NOT EXISTS knowledge_entries_updated_idx ON knowledge_entries (updated_at DESC)`;
    await q`
      CREATE TABLE IF NOT EXISTS processed_updates (
        update_id    BIGINT PRIMARY KEY,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE INDEX IF NOT EXISTS processed_updates_at_idx ON processed_updates (processed_at)`;
    // Diagnostic: record the update TYPE so the dashboard can show
    // "we got 0 channel_post events" instead of leaving the user
    // guessing whether Telegram is even sending them. chat_id and a
    // tiny preview snippet help match against a specific channel.
    await q`ALTER TABLE processed_updates ADD COLUMN IF NOT EXISTS update_type TEXT`;
    await q`ALTER TABLE processed_updates ADD COLUMN IF NOT EXISTS chat_id BIGINT`;
    await q`ALTER TABLE processed_updates ADD COLUMN IF NOT EXISTS preview TEXT`;
    await q`CREATE INDEX IF NOT EXISTS processed_updates_type_idx ON processed_updates (update_type, processed_at DESC) WHERE update_type IS NOT NULL`;

    // --- Multi-tenant foundation ---
    // A tenant is an isolated workspace. Each holds its own business
    // connections, monitored Instagram accounts, message history,
    // budget, and (later) API key overrides. Tenants are created
    // and managed by admins; ordinary users land in exactly one
    // tenant based on the business_connection they own.
    await q`
      CREATE TABLE IF NOT EXISTS tenants (
        id                      BIGSERIAL PRIMARY KEY,
        name                    TEXT NOT NULL UNIQUE,
        plan                    TEXT NOT NULL DEFAULT 'starter',
        hiker_budget_usd        NUMERIC(10, 2) NOT NULL DEFAULT 50,
        hiker_approved_usd      NUMERIC(10, 2) NOT NULL DEFAULT 10,
        hiker_approval_step_usd NUMERIC(10, 2) NOT NULL DEFAULT 10,
        monitored_cap           INT NOT NULL DEFAULT 50,
        is_enabled              BOOLEAN NOT NULL DEFAULT TRUE,
        notes                   TEXT,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    // Per-tenant API key overrides. Empty = fall through to the
    // global settings override and then env. Admin owns these via
    // /api/admin/tenants/[id]/keys.
    await q`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS hiker_api_key TEXT`;
    await q`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS hiker_api_key_name TEXT`;
    await q`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS openrouter_api_key TEXT`;
    await q`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS groq_api_key TEXT`;
    // Per-tenant OpenRouter budget (same shape as the hiker_* columns).
    // Default $20 cap, $5 currently approved, $5 step — small enough
    // that a fresh deploy without explicit budget won't burn through
    // an unintended balance.
    await q`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS openrouter_budget_usd        NUMERIC(10, 2) NOT NULL DEFAULT 20`;
    await q`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS openrouter_approved_usd      NUMERIC(10, 2) NOT NULL DEFAULT 5`;
    await q`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS openrouter_approval_step_usd NUMERIC(10, 2) NOT NULL DEFAULT 5`;
    // Per-tenant overrides for the same global setting keys that
    // /api/settings already manages. NULL value means "use global".
    // Admin manages these via /settings?tenant=<id>.
    await q`
      CREATE TABLE IF NOT EXISTS tenant_settings (
        tenant_id  BIGINT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by BIGINT,
        PRIMARY KEY (tenant_id, key)
      )`;
    await q`CREATE INDEX IF NOT EXISTS tenant_settings_tenant_idx ON tenant_settings (tenant_id)`;
    // Owner-uploaded binary assets (currently just the reference photo
    // used by ai_generate_photo). Stored as BYTEA so the operator
    // doesn't have to host an image somewhere public. tenant_id is
    // nullable for global / single-tenant installs; the unique index
    // uses COALESCE so NULL and 0 both collapse to one row per kind.
    await q`
      CREATE TABLE IF NOT EXISTS owner_assets (
        id          BIGSERIAL PRIMARY KEY,
        kind        TEXT NOT NULL,
        tenant_id   BIGINT,
        mime        TEXT NOT NULL,
        data        BYTEA NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE UNIQUE INDEX IF NOT EXISTS owner_assets_kind_tenant_uniq ON owner_assets (kind, COALESCE(tenant_id, 0))`;
    // Natural-language "rules" for tagging + forwarding incoming
    // messages. The operator writes a prompt ("messages containing an
    // OTP / verification code"); on each new message the LLM decides
    // which rules match and we forward to the recipients set per rule.
    // forward_format (optional) is a second prompt used to reformat
    // the message before forwarding — e.g. extract just the code.
    await q`
      CREATE TABLE IF NOT EXISTS message_rules (
        id              BIGSERIAL PRIMARY KEY,
        tenant_id       BIGINT,
        name            TEXT NOT NULL,
        description     TEXT NOT NULL,
        forward_format  TEXT,
        enabled         BOOLEAN NOT NULL DEFAULT TRUE,
        created_by      BIGINT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE INDEX IF NOT EXISTS message_rules_tenant_idx ON message_rules (tenant_id) WHERE tenant_id IS NOT NULL`;
    await q`CREATE INDEX IF NOT EXISTS message_rules_enabled_idx ON message_rules (enabled) WHERE enabled = TRUE`;
    // Recipients per rule. recipient_chat_id can be a user id (DM with
    // the bot — they must have /start'd) or a group/channel id the bot
    // is a member of. PK keeps duplicates out.
    await q`
      CREATE TABLE IF NOT EXISTS message_rule_recipients (
        rule_id          BIGINT NOT NULL,
        recipient_chat_id BIGINT NOT NULL,
        recipient_label  TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (rule_id, recipient_chat_id)
      )`;
    await q`CREATE INDEX IF NOT EXISTS message_rule_recipients_chat_idx ON message_rule_recipients (recipient_chat_id)`;
    // Match history. One row per (rule, message_log) so the rule detail
    // page can show what's been matching it and what was forwarded.
    await q`
      CREATE TABLE IF NOT EXISTS message_rule_matches (
        id              BIGSERIAL PRIMARY KEY,
        rule_id         BIGINT NOT NULL,
        message_log_id  BIGINT NOT NULL,
        formatted_text  TEXT,
        forwarded_to    BIGINT[],
        matched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE INDEX IF NOT EXISTS message_rule_matches_rule_idx ON message_rule_matches (rule_id, matched_at DESC)`;
    await q`CREATE INDEX IF NOT EXISTS message_rule_matches_message_idx ON message_rule_matches (message_log_id)`;
    // Per-recipient failure reasons so the dashboard can show why a
    // forward to a specific chat_id didn't land (blocked the bot,
    // /start not run, rate-limited, etc.). Shape: { "<chat_id>": "<reason>" }.
    await q`ALTER TABLE message_rule_matches ADD COLUMN IF NOT EXISTS forward_errors JSONB`;
    // Additional example texts per rule. The operator can grow a rule
    // by feeding it more real message bodies; matching is a disjunction
    // of the description + all examples ("does the incoming msg fit
    // ANY of these?").
    await q`
      CREATE TABLE IF NOT EXISTS message_rule_examples (
        id          BIGSERIAL PRIMARY KEY,
        rule_id     BIGINT NOT NULL,
        text        TEXT NOT NULL,
        label       TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE INDEX IF NOT EXISTS message_rule_examples_rule_idx ON message_rule_examples (rule_id)`;
    // purpose distinguishes Gate paraphrases (gate_match — phrasings
    // that should OPEN the request gate) from OTP-carrier examples
    // (rule_match — messages we want to FORWARD when they arrive).
    // Default 'rule_match' to keep legacy rows behaving as before.
    await q`ALTER TABLE message_rule_examples
      ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'rule_match'`;
    // One-shot backfill: previous AI paraphrase tool stuffed gate
    // examples into rule_match. Move anything labeled "🤖 ساخته‌ی AI"
    // to its proper purpose so the new UI shows them in the right
    // place AND OTP-extraction stops false-matching the operator's
    // own asking message.
    {
      const flag = await q`SELECT value FROM settings WHERE key = 'migration.gate_examples_purpose.v1'`;
      if ((flag as unknown[]).length === 0) {
        await q`UPDATE message_rule_examples
          SET purpose = 'gate_match'
          WHERE label = '🤖 ساخته‌ی AI' AND purpose = 'rule_match'`;
        await q`INSERT INTO settings (key, value) VALUES ('migration.gate_examples_purpose.v1', 'done')
                ON CONFLICT (key) DO NOTHING`;
      }
    }
    await q`CREATE INDEX IF NOT EXISTS message_rule_examples_purpose_idx
      ON message_rule_examples (rule_id, purpose)`;
    // Request-gate: optionally hold forwarding until the recipient
    // sends a message matching `request_trigger` within the last
    // `request_window_seconds` seconds. NULL window = "always" (no gate).
    await q`ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS request_trigger TEXT`;
    await q`ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS request_window_seconds INT`;
    // Optional source allowlist: comma-separated chat_ids. When set,
    // ONLY messages arriving from these chats can match the rule —
    // deterministic scoping so a broad description can't grab codes
    // from unrelated conversations.
    await q`ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS source_chat_ids TEXT`;
    // Narrow a source chat down to specific forum TOPICS. A group like
    // LimooMe carries unrelated traffic in a dozen threads, so scoping a
    // rule to the whole chat is far too broad — the DevOps topic's
    // tickets should forward, the rest of the group should not.
    // Empty/NULL = every topic in the allowed chats.
    await q`ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS source_thread_ids TEXT`;
    // Deterministic pre-filter, applied BEFORE the LLM classifier. The
    // classifier decides what a message means, which is the wrong tool
    // for "must literally start with a ticket header" — it will always
    // be willing to read intent into free text somebody typed. A regex
    // that has to match first makes the shape a hard requirement, and
    // cuts the classifier out of the loop entirely for everything else.
    await q`ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS match_pattern TEXT`;
    // When ON together with source_chat_ids, EVERY message from an
    // allowed source chat matches — no LLM content check. For a
    // dedicated feed (e.g. a bank's SMS-forwarder chat) content
    // classification is both unnecessary and unreliable; the source IS
    // the signal. In OTP mode, code-less messages are still skipped at
    // forward time, so only the ones carrying a code go out.
    await q`ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS match_all_from_source BOOLEAN NOT NULL DEFAULT FALSE`;
    // Optional "🏷 [rule: …]" prefix on the forwarded message.
    // Default TRUE for backward compat with existing rules.
    await q`ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS show_rule_prefix BOOLEAN NOT NULL DEFAULT TRUE`;
    // OTP rendering: when ON, the bot extracts the digit code from
    // the matched body and wraps it in <code>...</code> so Telegram
    // renders it as a tap-to-copy block. The custom forward_format
    // prompt is ignored in this mode.
    await q`ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS format_as_otp BOOLEAN NOT NULL DEFAULT FALSE`;
    // Operator-written header line(s) prepended to every forward of this
    // rule (e.g. «🎫 درخواست تیک جدید داریم»). Static text — unlike
    // forward_format it costs no model call. NULL = no header.
    await q`ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS forward_header TEXT`;
    // Scoped MCP tokens. A token here is NOT the master MCP_SECRET: it
    // may only touch the chats listed in read_chat_ids, may only write
    // into (write_chat_id, write_thread_id), and never gets the raw
    // SQL tools. Handing one to another agent/session is therefore safe.
    await q`
      CREATE TABLE IF NOT EXISTS mcp_tokens (
        id              BIGSERIAL PRIMARY KEY,
        token           TEXT NOT NULL UNIQUE,
        label           TEXT NOT NULL,
        read_chat_ids   TEXT,
        write_chat_id   BIGINT,
        write_thread_id INTEGER,
        can_create_topic BOOLEAN NOT NULL DEFAULT FALSE,
        enabled         BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at    TIMESTAMPTZ
      )`;
    // A token may instead be marked full_access — the same power as the
    // master MCP_SECRET, but individually labelled and revocable, so a
    // leak means disabling one row rather than rotating the master key
    // across every client that uses it.
    await q`ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS full_access BOOLEAN NOT NULL DEFAULT FALSE`;
    // A contact sends a media link in a PRIVATE chat; we relay it to the
    // matching downloader bot as the owner (over the business
    // connection — a bot cannot message another bot) and return whatever
    // comes back to whoever sent the link. One row per in-flight request.
    await q`
      CREATE TABLE IF NOT EXISTS link_download_jobs (
        id                BIGSERIAL PRIMARY KEY,
        kind              TEXT NOT NULL,
        relay_bot_id      BIGINT NOT NULL,
        source_chat_id    BIGINT NOT NULL,
        source_message_id BIGINT,
        link              TEXT NOT NULL,
        relay_message_id  BIGINT,
        status            TEXT NOT NULL DEFAULT 'pending',
        delivered         INTEGER NOT NULL DEFAULT 0,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at      TIMESTAMPTZ
      )`;
    await q`CREATE INDEX IF NOT EXISTS link_jobs_pending_idx
      ON link_download_jobs (relay_bot_id, status, created_at) WHERE status = 'pending'`;
    // Operator-configurable downloader routes: which hosts go to which
    // bot. hosts is a comma-separated list matched against the parsed
    // hostname (exact or as a parent domain) — never a substring, so a
    // lookalike like open.spotify.com.attacker.net cannot match.
    await q`
      CREATE TABLE IF NOT EXISTS link_downloaders (
        id         BIGSERIAL PRIMARY KEY,
        label      TEXT NOT NULL,
        kind       TEXT NOT NULL,
        bot_id     BIGINT NOT NULL,
        hosts      TEXT NOT NULL,
        enabled    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    // Seed the two the operator started with; ON CONFLICT-free because
    // we only insert when the table is empty.
    const seeded = await q`SELECT 1 FROM link_downloaders LIMIT 1`;
    if ((seeded as unknown[]).length === 0) {
      await q`INSERT INTO link_downloaders (label, kind, bot_id, hosts) VALUES
        ('Instagram', 'instagram', 2010101852, 'instagram.com,instagr.am'),
        ('Spotify', 'spotify', 5984546179, 'open.spotify.com,spotify.link')`;
    }
    // Token-gated read-only feeds that expose ONLY the code-carrying
    // messages of one chat, and only those inside a short time window.
    // allowed_ips is an optional CIDR/plain-IP allowlist evaluated
    // against the real client IP (CF-Connecting-IP behind Cloudflare).
    await q`
      CREATE TABLE IF NOT EXISTS code_feeds (
        id             BIGSERIAL PRIMARY KEY,
        token          TEXT NOT NULL UNIQUE,
        label          TEXT NOT NULL,
        chat_id        BIGINT NOT NULL,
        window_seconds INTEGER NOT NULL DEFAULT 300,
        format         TEXT NOT NULL DEFAULT 'json',
        codes_only     BOOLEAN NOT NULL DEFAULT TRUE,
        allowed_ips    TEXT,
        enabled        BOOLEAN NOT NULL DEFAULT TRUE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_access_at TIMESTAMPTZ,
        last_access_ip TEXT
      )`;
    // Per (rule, recipient) timestamp of the last request_trigger
    // match. The gate window is BIDIRECTIONAL: a code arriving WITHIN
    // last_request_at + window also forwards immediately. Without
    // this column we'd only support lookback.
    await q`ALTER TABLE message_rule_recipients ADD COLUMN IF NOT EXISTS last_request_at TIMESTAMPTZ`;
    // Temporary pause: a paused recipient stays configured but receives
    // no forwards until resumed (distinct from delete).
    await q`ALTER TABLE message_rule_recipients ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE`;
    // Throttle for "AI started auto-replying in chat X" owner notices —
    // one row per (connection, chat) with the last time we notified.
    await q`
      CREATE TABLE IF NOT EXISTS ai_reply_notifications (
        business_connection_id TEXT NOT NULL,
        chat_id                BIGINT NOT NULL,
        last_notified_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (business_connection_id, chat_id)
      )`;
    // Buffers the parts of an incoming album (media_group) while the
    // channel-mirror waits for the whole group to arrive (albums come
    // as separate updates). group_key = "<media_group_id>:<target>".
    await q`
      CREATE TABLE IF NOT EXISTS mirror_album_buffer (
        id                BIGSERIAL PRIMARY KEY,
        group_key         TEXT NOT NULL,
        target_chat_id    BIGINT NOT NULL,
        thread_id         INTEGER,
        source_message_id BIGINT NOT NULL,
        file_id           TEXT NOT NULL,
        kind              TEXT NOT NULL,
        caption           TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE INDEX IF NOT EXISTS mirror_album_buffer_grp ON mirror_album_buffer (group_key, source_message_id)`;
    // One row per flushed group — the INSERT that wins is the single
    // invocation allowed to send the grouped album (dedup guard so
    // concurrent album parts don't each fire a sendMediaGroup).
    await q`
      CREATE TABLE IF NOT EXISTS mirror_album_claim (
        group_key   TEXT PRIMARY KEY,
        claimed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    // Human-editable task board per group. Seeded once from the AI
    // analysis, then maintained by hand via /board/<token>. Kept
    // SEPARATE from group_analytics (the AI view) so edits are never
    // clobbered by re-analysis.
    await q`
      CREATE TABLE IF NOT EXISTS group_board_tasks (
        id          BIGSERIAL PRIMARY KEY,
        chat_id     BIGINT NOT NULL,
        title       TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'todo',
        assignee    TEXT,
        topic       TEXT,
        note        TEXT,
        position    INTEGER NOT NULL DEFAULT 0,
        source      TEXT NOT NULL DEFAULT 'manual',
        created_by  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE INDEX IF NOT EXISTS group_board_tasks_chat_idx ON group_board_tasks (chat_id, status, position)`;
    // Extra trackable fields: priority (key), labels (JSON id array), due date.
    await q`ALTER TABLE group_board_tasks ADD COLUMN IF NOT EXISTS priority TEXT`;
    await q`ALTER TABLE group_board_tasks ADD COLUMN IF NOT EXISTS labels JSONB`;
    await q`ALTER TABLE group_board_tasks ADD COLUMN IF NOT EXISTS due_date DATE`;
    // Marker so the AI seed runs at most once per chat.
    await q`
      CREATE TABLE IF NOT EXISTS group_board_seeded (
        chat_id    BIGINT PRIMARY KEY,
        seeded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    // Audit log for the board: every create/update/delete keeps a
    // before/after snapshot so any change can be reverted.
    await q`
      CREATE TABLE IF NOT EXISTS group_board_events (
        id          BIGSERIAL PRIMARY KEY,
        chat_id     BIGINT NOT NULL,
        task_id     BIGINT,
        action      TEXT NOT NULL,
        actor       TEXT,
        summary     TEXT NOT NULL,
        before_json JSONB,
        after_json  JSONB,
        reverted    BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE INDEX IF NOT EXISTS group_board_events_chat_idx ON group_board_events (chat_id, created_at DESC)`;
    // Per-board membership: who logged in with Telegram and whether the
    // owner approved them for THIS board. No shared code — access is a
    // verified Telegram identity plus an explicit owner approval.
    await q`
      CREATE TABLE IF NOT EXISTS board_members (
        chat_id     BIGINT NOT NULL,
        tg_id       BIGINT NOT NULL,
        tg_username TEXT,
        tg_name     TEXT,
        status      TEXT NOT NULL DEFAULT 'pending',
        decided_by  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        decided_at  TIMESTAMPTZ,
        PRIMARY KEY (chat_id, tg_id)
      )`;
    await q`CREATE INDEX IF NOT EXISTS board_members_chat_idx ON board_members (chat_id, status)`;
    // Threaded comments per board task.
    await q`
      CREATE TABLE IF NOT EXISTS board_task_comments (
        id         BIGSERIAL PRIMARY KEY,
        chat_id    BIGINT NOT NULL,
        task_id    BIGINT NOT NULL,
        author     TEXT,
        body       TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`CREATE INDEX IF NOT EXISTS board_task_comments_idx ON board_task_comments (chat_id, task_id, created_at)`;
    // Editable content tabs alongside the kanban (critical items, key
    // points, people & roles, …). Seeded once from the AI analysis, then
    // freely editable/manageable.
    await q`
      CREATE TABLE IF NOT EXISTS board_tabs (
        id         BIGSERIAL PRIMARY KEY,
        chat_id    BIGINT NOT NULL,
        title      TEXT NOT NULL,
        icon       TEXT,
        body       TEXT,
        kind       TEXT NOT NULL DEFAULT 'list',
        config     JSONB,
        items      JSONB,
        position   INTEGER NOT NULL DEFAULT 0,
        source     TEXT NOT NULL DEFAULT 'manual',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`ALTER TABLE board_tabs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'list'`;
    await q`ALTER TABLE board_tabs ADD COLUMN IF NOT EXISTS config JSONB`;
    await q`ALTER TABLE board_tabs ADD COLUMN IF NOT EXISTS items JSONB`;
    await q`CREATE INDEX IF NOT EXISTS board_tabs_chat_idx ON board_tabs (chat_id, position)`;
    await q`
      CREATE TABLE IF NOT EXISTS board_tabs_seeded (
        chat_id   BIGINT PRIMARY KEY,
        seeded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    // Tracks which usernames we've registered with the external
    // change-detector. last_status is the HTTP status from the most
    // recent push so the admin can see drift.
    await q`
      CREATE TABLE IF NOT EXISTS monitor_subscriptions (
        username          TEXT PRIMARY KEY,
        registered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        unregistered_at   TIMESTAMPTZ,
        last_pushed_at    TIMESTAMPTZ,
        last_status       INT,
        last_notified_at  TIMESTAMPTZ,
        notify_count      INT NOT NULL DEFAULT 0
      )`;
    await q`CREATE INDEX IF NOT EXISTS monitor_subscriptions_active_idx ON monitor_subscriptions (registered_at DESC) WHERE unregistered_at IS NULL`;
    await q`
      CREATE TABLE IF NOT EXISTS admin_users (
        user_id    BIGINT PRIMARY KEY,
        username   TEXT,
        first_name TEXT,
        added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        added_by   BIGINT
      )`;
    // tenant_id columns on every tenant-scoped table. All nullable
    // for now so the existing routes (which don't filter yet) keep
    // working. Subsequent commits will enforce NOT NULL where it
    // makes sense.
    await q`ALTER TABLE business_connections ADD COLUMN IF NOT EXISTS tenant_id BIGINT REFERENCES tenants(id) ON DELETE SET NULL`;
    await q`ALTER TABLE messages_log         ADD COLUMN IF NOT EXISTS tenant_id BIGINT`;
    await q`ALTER TABLE chat_rules           ADD COLUMN IF NOT EXISTS tenant_id BIGINT`;
    await q`ALTER TABLE monitored_accounts   ADD COLUMN IF NOT EXISTS tenant_id BIGINT`;
    await q`ALTER TABLE monitor_events       ADD COLUMN IF NOT EXISTS tenant_id BIGINT`;
    await q`ALTER TABLE hikerapi_usage       ADD COLUMN IF NOT EXISTS tenant_id BIGINT`;
    await q`ALTER TABLE ai_usage             ADD COLUMN IF NOT EXISTS tenant_id BIGINT`;
    await q`ALTER TABLE thread_summaries     ADD COLUMN IF NOT EXISTS tenant_id BIGINT`;
    await q`ALTER TABLE extracted_items      ADD COLUMN IF NOT EXISTS tenant_id BIGINT`;
    await q`ALTER TABLE audit_log            ADD COLUMN IF NOT EXISTS tenant_id BIGINT`;
    await q`ALTER TABLE ask_queries          ADD COLUMN IF NOT EXISTS tenant_id BIGINT`;
    await q`CREATE INDEX IF NOT EXISTS business_connections_tenant_idx ON business_connections (tenant_id) WHERE tenant_id IS NOT NULL`;
    await q`CREATE INDEX IF NOT EXISTS messages_log_tenant_idx ON messages_log (tenant_id, created_at DESC) WHERE tenant_id IS NOT NULL`;
    await q`CREATE INDEX IF NOT EXISTS chat_rules_tenant_idx ON chat_rules (tenant_id) WHERE tenant_id IS NOT NULL`;
    await q`CREATE INDEX IF NOT EXISTS monitored_accounts_tenant_idx ON monitored_accounts (tenant_id) WHERE tenant_id IS NOT NULL`;
    await q`CREATE INDEX IF NOT EXISTS monitor_events_tenant_idx ON monitor_events (tenant_id, detected_at DESC) WHERE tenant_id IS NOT NULL`;
    await q`CREATE INDEX IF NOT EXISTS hikerapi_usage_tenant_idx ON hikerapi_usage (tenant_id, called_at DESC) WHERE tenant_id IS NOT NULL`;
    await q`CREATE INDEX IF NOT EXISTS ai_usage_tenant_idx ON ai_usage (tenant_id, created_at DESC) WHERE tenant_id IS NOT NULL`;
    await q`CREATE INDEX IF NOT EXISTS thread_summaries_tenant_idx ON thread_summaries (tenant_id) WHERE tenant_id IS NOT NULL`;

    // Fallback admin seed: if admin_users ended up empty (e.g. the
    // ADMIN_USER_IDS env wasn't set when commit 1 first ran), promote
    // every existing business_connection owner to admin so the human
    // who set up the bot can log in to /admin and take over. Idempotent
    // — once anyone is in admin_users this no-ops.
    {
      const flag = await q`SELECT value FROM settings WHERE key = 'migration.admin_seed_existing_owners.v1'`;
      if ((flag as unknown[]).length === 0) {
        const adminCount = await q`SELECT COUNT(*)::int AS n FROM admin_users`;
        const n = Number((adminCount[0] as { n?: number } | undefined)?.n ?? 0);
        if (n === 0) {
          await q`
            INSERT INTO admin_users (user_id, username, first_name)
            SELECT DISTINCT user_id, username, first_name
            FROM business_connections
            WHERE user_id IS NOT NULL
            ON CONFLICT (user_id) DO NOTHING`;
        }
        await q`INSERT INTO settings (key, value) VALUES ('migration.admin_seed_existing_owners.v1', 'done')
                ON CONFLICT (key) DO NOTHING`;
      }
    }
    // One-time migration: bootstrap the multi-tenant world.
    //   1. Seed admin_users from ADMIN_USER_IDS env CSV.
    //   2. Create a "Default" tenant if none exist.
    //   3. Attach every existing business_connection to that
    //      Default tenant.
    //   4. Backfill all tenant_scoped tables row-by-row from the
    //      owner_user_id / business_connection_id columns they
    //      already have — orphan rows go to Default too.
    {
      const flag = await q`SELECT value FROM settings WHERE key = 'migration.tenants_bootstrap.v1'`;
      if ((flag as unknown[]).length === 0) {
        // Seed admins from env CSV.
        const adminCsv = (process.env.ADMIN_USER_IDS ?? "").trim();
        if (adminCsv) {
          for (const part of adminCsv.split(",")) {
            const id = Number(part.trim());
            if (!Number.isFinite(id) || id === 0) continue;
            await q`INSERT INTO admin_users (user_id) VALUES (${id})
                    ON CONFLICT (user_id) DO NOTHING`;
          }
        }
        // Default tenant.
        const tRows = await q`
          INSERT INTO tenants (name, plan, hiker_budget_usd, hiker_approved_usd, hiker_approval_step_usd, notes)
          VALUES ('Default', 'starter', 50, 10, 10, 'Auto-created by multi-tenant migration')
          ON CONFLICT (name) DO UPDATE SET updated_at = NOW()
          RETURNING id`;
        const defaultId = Number(
          (tRows[0] as { id?: string | number } | undefined)?.id ?? 0,
        );
        // Attach every existing business connection to Default
        // unless it's already attached somewhere.
        await q`UPDATE business_connections
                SET tenant_id = ${defaultId}, updated_at = NOW()
                WHERE tenant_id IS NULL`;
        // Backfill tenant-scoped tables via the business_connection
        // join when possible, otherwise straight to Default.
        await q`UPDATE messages_log AS m
                SET tenant_id = bc.tenant_id
                FROM business_connections bc
                WHERE m.tenant_id IS NULL
                  AND m.business_connection_id = bc.id
                  AND bc.tenant_id IS NOT NULL`;
        await q`UPDATE messages_log SET tenant_id = ${defaultId} WHERE tenant_id IS NULL`;
        await q`UPDATE chat_rules SET tenant_id = ${defaultId} WHERE tenant_id IS NULL`;
        await q`UPDATE monitored_accounts SET tenant_id = ${defaultId} WHERE tenant_id IS NULL`;
        await q`UPDATE monitor_events SET tenant_id = ${defaultId} WHERE tenant_id IS NULL`;
        await q`UPDATE hikerapi_usage SET tenant_id = ${defaultId} WHERE tenant_id IS NULL`;
        await q`UPDATE ai_usage SET tenant_id = ${defaultId} WHERE tenant_id IS NULL`;
        await q`UPDATE thread_summaries SET tenant_id = ${defaultId} WHERE tenant_id IS NULL`;
        await q`UPDATE extracted_items SET tenant_id = ${defaultId} WHERE tenant_id IS NULL`;
        await q`UPDATE audit_log SET tenant_id = ${defaultId} WHERE tenant_id IS NULL`;
        await q`UPDATE ask_queries SET tenant_id = ${defaultId} WHERE tenant_id IS NULL`;
        await q`INSERT INTO settings (key, value) VALUES ('migration.tenants_bootstrap.v1', 'done')
                ON CONFLICT (key) DO NOTHING`;
      }

      // v2 backfill: between v1 and the logMessage fix, every new
      // insert went in with tenant_id=NULL, so all messages from
      // ~14d ago through the deploy date are invisible to the
      // multi-tenant follow-up query. Re-run the same backfill once
      // under a fresh flag to repair them.
      const v2 = await q`SELECT value FROM settings WHERE key = 'migration.tenants_backfill.v2'`;
      if ((v2 as Array<unknown>).length === 0) {
        const defaultRows = await q`SELECT id FROM tenants WHERE name = 'Default' LIMIT 1`;
        const defaultRow = (defaultRows as Array<{ id: string | number }>)[0];
        if (defaultRow) {
          const defaultId = Number(defaultRow.id);
          await q`UPDATE messages_log AS m
                  SET tenant_id = bc.tenant_id
                  FROM business_connections bc
                  WHERE m.tenant_id IS NULL
                    AND m.business_connection_id = bc.id
                    AND bc.tenant_id IS NOT NULL`;
          await q`UPDATE messages_log SET tenant_id = ${defaultId} WHERE tenant_id IS NULL`;
          await q`INSERT INTO settings (key, value) VALUES ('migration.tenants_backfill.v2', 'done')
                  ON CONFLICT (key) DO NOTHING`;
        }
      }
    }
    // Stamp the version so the next cold start takes the fast path.
    if (!clientOverride) {
      await q`
        INSERT INTO settings (key, value) VALUES ('schema.version', ${SCHEMA_VERSION})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`.catch(() => {});
    }
  })().catch((err) => {
    if (!clientOverride) schemaPromise = null;
    throw err;
  });
  if (!clientOverride) schemaPromise = run;
  return run;
}
