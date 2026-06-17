import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { config } from "./config";

let cached: NeonQueryFunction<false, false> | null = null;
let schemaPromise: Promise<void> | null = null;

export function hasDb(): boolean {
  return Boolean(config.databaseUrl);
}

export function sql(): NeonQueryFunction<false, false> {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!cached) cached = neon(config.databaseUrl);
  return cached;
}

export async function ensureSchema(): Promise<void> {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const q = sql();
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
    // Request-gate: optionally hold forwarding until the recipient
    // sends a message matching `request_trigger` within the last
    // `request_window_seconds` seconds. NULL window = "always" (no gate).
    await q`ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS request_trigger TEXT`;
    await q`ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS request_window_seconds INT`;
    // Optional "🏷 [rule: …]" prefix on the forwarded message.
    // Default TRUE for backward compat with existing rules.
    await q`ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS show_rule_prefix BOOLEAN NOT NULL DEFAULT TRUE`;
    // OTP rendering: when ON, the bot extracts the digit code from
    // the matched body and wraps it in <code>...</code> so Telegram
    // renders it as a tap-to-copy block. The custom forward_format
    // prompt is ignored in this mode.
    await q`ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS format_as_otp BOOLEAN NOT NULL DEFAULT FALSE`;
    // Per (rule, recipient) timestamp of the last request_trigger
    // match. The gate window is BIDIRECTIONAL: a code arriving WITHIN
    // last_request_at + window also forwards immediately. Without
    // this column we'd only support lookback.
    await q`ALTER TABLE message_rule_recipients ADD COLUMN IF NOT EXISTS last_request_at TIMESTAMPTZ`;
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
        const n = Number((adminCount[0] as { n: number }).n);
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
        const defaultId = Number((tRows[0] as { id: string | number }).id);
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
    }
  })().catch((err) => {
    schemaPromise = null;
    throw err;
  });
  return schemaPromise;
}

// --- Business connections ---

export async function upsertBusinessConnection(args: {
  id: string;
  userId: number;
  userChatId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  canReply: boolean;
  isEnabled: boolean;
}): Promise<void> {
  await ensureSchema();
  const q = sql();
  await q`
    INSERT INTO business_connections (
      id, user_id, user_chat_id, username, first_name, last_name,
      can_reply, is_enabled, updated_at
    ) VALUES (
      ${args.id}, ${args.userId}, ${args.userChatId},
      ${args.username ?? null}, ${args.firstName ?? null}, ${args.lastName ?? null},
      ${args.canReply}, ${args.isEnabled}, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      user_chat_id = EXCLUDED.user_chat_id,
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      can_reply = EXCLUDED.can_reply,
      is_enabled = EXCLUDED.is_enabled,
      updated_at = NOW()`;
  // If this row landed without a tenant_id (brand-new connection),
  // park it on Default so admin can move it later. We never
  // clobber an existing assignment — an admin may have already
  // routed this connection to a non-Default tenant.
  await q`
    UPDATE business_connections
    SET tenant_id = (SELECT id FROM tenants WHERE name = 'Default' LIMIT 1)
    WHERE id = ${args.id} AND tenant_id IS NULL`;
}

export async function getBusinessConnection(
  id: string,
): Promise<{ userId: number; userChatId: number; canReply: boolean } | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT user_id, user_chat_id, can_reply
    FROM business_connections WHERE id = ${id} AND is_enabled = TRUE LIMIT 1`;
  const r = rows[0] as { user_id: string; user_chat_id: string; can_reply: boolean } | undefined;
  if (!r) return null;
  return {
    userId: Number(r.user_id),
    userChatId: Number(r.user_chat_id),
    canReply: r.can_reply,
  };
}

export async function listBusinessConnections(): Promise<BusinessConnectionRow[]> {
  await ensureSchema();
  const rows = await sql()`
    SELECT id, user_id, user_chat_id, username, first_name, last_name,
           can_reply, is_enabled, tenant_id, created_at, updated_at
    FROM business_connections ORDER BY updated_at DESC`;
  return rows.map((r) => ({
    id: r.id as string,
    userId: Number(r.user_id),
    userChatId: Number(r.user_chat_id),
    username: r.username as string | null,
    firstName: r.first_name as string | null,
    lastName: r.last_name as string | null,
    canReply: r.can_reply as boolean,
    isEnabled: r.is_enabled as boolean,
    tenantId: r.tenant_id == null ? null : Number(r.tenant_id),
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  }));
}

export type BusinessConnectionRow = {
  id: string;
  userId: number;
  userChatId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  canReply: boolean;
  isEnabled: boolean;
  tenantId: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function isAllowedUser(userId: number): Promise<boolean> {
  if (!hasDb()) return false;
  await ensureSchema();
  const rows = await sql()`
    SELECT 1 FROM business_connections WHERE user_id = ${userId} LIMIT 1`;
  return rows.length > 0;
}

// --- Messages log ---

export type LogMessage = {
  businessConnectionId: string | null;
  ownerUserId: number | null;
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  senderId: number | null;
  senderUsername: string | null;
  senderName: string;
  messageId: number;
  messageText: string;
  importance: number;
  urgent: boolean;
  concernsOwner: boolean;
  reason: string;
  alerted: boolean;
  autoReplied: boolean;
  fromOwner?: boolean;
  skippedReason?: string | null;
  mediaFileId?: string | null;
  mediaKind?: string | null;
  source?: string | null;
  messageThreadId?: number | null;
  inlineButtons?: Array<{ label: string; url: string }> | null;
};

export async function logMessage(m: LogMessage): Promise<number> {
  await ensureSchema();
  // Dedupe: the same outgoing message can reach us via both the send-call
  // (we log it) and a sender_business_bot echo (the bot's own outgoing
  // arrives as a business_message). Return the existing id if so. For
  // groups (no bcId), message_id is unique within chat_id so that pair
  // is enough.
  const existing =
    m.businessConnectionId === null
      ? await sql()`
          SELECT id FROM messages_log
          WHERE business_connection_id IS NULL
            AND chat_id = ${m.chatId}
            AND message_id = ${m.messageId}
          LIMIT 1`
      : await sql()`
          SELECT id FROM messages_log
          WHERE business_connection_id = ${m.businessConnectionId}
            AND chat_id = ${m.chatId}
            AND message_id = ${m.messageId}
          LIMIT 1`;
  if (existing.length > 0) {
    return Number((existing[0] as { id: string }).id);
  }
  const buttonsJson =
    m.inlineButtons && m.inlineButtons.length > 0
      ? JSON.stringify(m.inlineButtons)
      : null;
  const rows = await sql()`
    INSERT INTO messages_log (
      business_connection_id, owner_user_id, chat_id, chat_type, chat_title,
      sender_id, sender_username, sender_name, message_id, message_text,
      importance, urgent, concerns_owner, reason, alerted, auto_replied,
      from_owner, skipped_reason, media_file_id, media_kind, source,
      message_thread_id, inline_buttons
    ) VALUES (
      ${m.businessConnectionId}, ${m.ownerUserId}, ${m.chatId}, ${m.chatType}, ${m.chatTitle},
      ${m.senderId}, ${m.senderUsername}, ${m.senderName}, ${m.messageId}, ${m.messageText},
      ${m.importance}, ${m.urgent}, ${m.concernsOwner}, ${m.reason}, ${m.alerted}, ${m.autoReplied},
      ${m.fromOwner ?? false}, ${m.skippedReason ?? null},
      ${m.mediaFileId ?? null}, ${m.mediaKind ?? null}, ${m.source ?? null},
      ${m.messageThreadId ?? null}, ${buttonsJson}::jsonb
    ) RETURNING id`;
  return Number((rows[0] as { id: string }).id);
}

// Record that the owner reacted to a customer message — counted as
// a reply by listFollowUpCandidates. Upsert so re-reactions on the
// same message just refresh the timestamp instead of duplicating.
export async function recordOwnerReaction(args: {
  chatId: number;
  businessConnectionId: string | null;
  messageId: number;
  emojis: string | null;
  tenantId: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO owner_reactions (
      chat_id, business_connection_id, message_id, emojis, tenant_id
    ) VALUES (
      ${args.chatId}, ${args.businessConnectionId}, ${args.messageId},
      ${args.emojis},
      COALESCE(
        ${args.tenantId}::bigint,
        (SELECT tenant_id FROM business_connections
          WHERE id = ${args.businessConnectionId} LIMIT 1)
      )
    )
    ON CONFLICT (chat_id, COALESCE(business_connection_id, ''), message_id)
    DO UPDATE SET emojis = EXCLUDED.emojis, reacted_at = NOW()`;
}

// --- Forum topics ---

export type ForumTopic = {
  chatId: number;
  messageThreadId: number;
  name: string | null;
  iconColor: number | null;
  iconEmoji: string | null;
  isClosed: boolean;
  isHidden: boolean;
  observedAt: Date;
};

export async function upsertForumTopic(args: {
  chatId: number;
  messageThreadId: number;
  name?: string | null;
  iconColor?: number | null;
  iconEmoji?: string | null;
  isClosed?: boolean;
  isHidden?: boolean;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO forum_topics (
      chat_id, message_thread_id, name, icon_color, icon_emoji, is_closed, is_hidden
    ) VALUES (
      ${args.chatId}, ${args.messageThreadId}, ${args.name ?? null},
      ${args.iconColor ?? null}, ${args.iconEmoji ?? null},
      ${args.isClosed ?? false}, ${args.isHidden ?? false}
    )
    ON CONFLICT (chat_id, message_thread_id) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, forum_topics.name),
      icon_color = COALESCE(EXCLUDED.icon_color, forum_topics.icon_color),
      icon_emoji = COALESCE(EXCLUDED.icon_emoji, forum_topics.icon_emoji),
      is_closed = EXCLUDED.is_closed,
      is_hidden = EXCLUDED.is_hidden,
      observed_at = NOW()`;
}

export async function listForumTopics(chatId: number): Promise<ForumTopic[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT chat_id, message_thread_id, name, icon_color, icon_emoji,
           is_closed, is_hidden, observed_at
    FROM forum_topics
    WHERE chat_id = ${chatId}
    ORDER BY message_thread_id ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    chatId: Number(r.chat_id),
    messageThreadId: Number(r.message_thread_id),
    name: (r.name as string) ?? null,
    iconColor: r.icon_color != null ? Number(r.icon_color) : null,
    iconEmoji: (r.icon_emoji as string) ?? null,
    isClosed: Boolean(r.is_closed),
    isHidden: Boolean(r.is_hidden),
    observedAt: r.observed_at as Date,
  }));
}

// Pull just the inline_buttons column for a single message — used by
// the email-html viewer so it can verify the requested URL is one of
// the buttons the message originally carried (not an arbitrary fetch).
export async function getMessageInlineButtons(
  id: number,
): Promise<Array<{ label: string; url: string }> | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT inline_buttons FROM messages_log WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as { inline_buttons: unknown } | undefined;
  if (!r) return null;
  return parseInlineButtons(r.inline_buttons);
}

// Watchlist match reporting: the "🚩 گزارش خطا" button under the
// notes_inbox notice records a wrong-match flag. The next time the
// scanner runs on a SIMILAR-looking message the bot can be more
// conservative (or the operator can re-tune the concept).
export async function getNoteWatchMatch(
  id: number,
): Promise<NoteWatchMatch | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, item_id, chat_id, chat_title, message_log_id, source_message_id,
           sender_name, quote, reason, forwarded_to, created_at
    FROM note_watch_matches WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToNoteWatchMatch(r) : null;
}

export async function markNoteWatchMatchWrong(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`UPDATE note_watch_matches SET reported_wrong_at = NOW() WHERE id = ${id}`;
}

export async function markNoteWatchMatchConfirmed(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`UPDATE note_watch_matches SET confirmed_at = NOW() WHERE id = ${id}`;
}

// Look up the full original message text by messages_log.id —
// powers the "📄 متن کامل" button under a watchlist notice.
export async function getMessageFullText(id: number): Promise<{
  text: string;
  chatTitle: string | null;
  senderName: string;
  createdAt: Date;
} | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT message_text, transcript, media_description, media_kind,
           chat_title, sender_name, created_at
    FROM messages_log WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  const body = (r.message_text as string) ?? "";
  const transcript = (r.transcript as string) ?? null;
  const desc = (r.media_description as string) ?? null;
  const kind = (r.media_kind as string) ?? null;
  let text = body;
  if (!text && transcript) text = `[voice] ${transcript}`;
  else if (!text && desc) text = `[${kind ?? "media"}] ${desc}`;
  else if (!text && kind) text = `[${kind}]`;
  return {
    text,
    chatTitle: (r.chat_title as string) ?? null,
    senderName: (r.sender_name as string) ?? "?",
    createdAt: r.created_at as Date,
  };
}

export async function getMessageForTranscript(id: number): Promise<{
  id: number;
  mediaFileId: string | null;
  mediaKind: string | null;
  transcript: string | null;
  transcriptAt: Date | null;
} | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, media_file_id, media_kind, transcript, transcript_at
    FROM messages_log WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as
    | {
        id: number;
        media_file_id: string | null;
        media_kind: string | null;
        transcript: string | null;
        transcript_at: Date | null;
      }
    | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    mediaFileId: r.media_file_id ?? null,
    mediaKind: r.media_kind ?? null,
    transcript: r.transcript ?? null,
    transcriptAt: r.transcript_at ?? null,
  };
}

export async function saveTranscript(
  id: number,
  transcript: string,
): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE messages_log
    SET transcript = ${transcript}, transcript_at = NOW()
    WHERE id = ${id}`;
}

export async function saveMediaDescription(
  id: number,
  description: string,
): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE messages_log
    SET media_description = ${description}, media_description_at = NOW()
    WHERE id = ${id}`;
}

// Mark every messages_log row for the given (bcId, chatId, messageId)
// tuples as deleted. Telegram pushes deleted_business_messages with a
// list of message_ids when either side erases a DM; we keep the row
// (and its text/transcript/media description) but stamp deleted_at so
// the dashboard can show the "Deleted" label without losing the
// content.
export async function markMessagesDeleted(args: {
  businessConnectionId: string;
  chatId: number;
  messageIds: number[];
}): Promise<number> {
  if (!hasDb() || args.messageIds.length === 0) return 0;
  await ensureSchema();
  const rows = await sql()`
    UPDATE messages_log
    SET deleted_at = NOW()
    WHERE business_connection_id = ${args.businessConnectionId}
      AND chat_id = ${args.chatId}
      AND message_id = ANY(${args.messageIds}::bigint[])
      AND deleted_at IS NULL
    RETURNING id`;
  return rows.length;
}

// Snapshot the existing text/transcript into message_edits and update
// the live row with the new text. Called from the edited_business_
// message handler. If nothing actually changed we no-op so we don't
// pad the history with phantom edits.
export async function recordMessageEdit(args: {
  businessConnectionId: string;
  chatId: number;
  messageId: number;
  newText: string;
  newTranscript?: string | null;
}): Promise<boolean> {
  if (!hasDb()) return false;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, message_text, transcript
    FROM messages_log
    WHERE business_connection_id = ${args.businessConnectionId}
      AND chat_id = ${args.chatId}
      AND message_id = ${args.messageId}
    LIMIT 1`;
  const r = rows[0] as
    | { id: string; message_text: string; transcript: string | null }
    | undefined;
  if (!r) return false;
  const oldText = r.message_text ?? "";
  const oldTranscript = r.transcript ?? null;
  const textChanged = oldText !== args.newText;
  const transcriptChanged =
    args.newTranscript !== undefined && args.newTranscript !== oldTranscript;
  if (!textChanged && !transcriptChanged) return false;
  await sql()`
    INSERT INTO message_edits (message_log_id, previous_text, previous_transcript)
    VALUES (${Number(r.id)}, ${oldText}, ${oldTranscript})`;
  if (transcriptChanged) {
    await sql()`
      UPDATE messages_log
      SET message_text = ${args.newText},
          transcript = ${args.newTranscript ?? null},
          edited_at = NOW()
      WHERE id = ${Number(r.id)}`;
  } else {
    await sql()`
      UPDATE messages_log
      SET message_text = ${args.newText},
          edited_at = NOW()
      WHERE id = ${Number(r.id)}`;
  }
  return true;
}

export type MessageEdit = {
  id: number;
  messageLogId: number;
  previousText: string | null;
  previousTranscript: string | null;
  editedAt: Date;
};

export async function getMessageEdits(
  messageLogId: number,
): Promise<MessageEdit[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, message_log_id, previous_text, previous_transcript, edited_at
    FROM message_edits
    WHERE message_log_id = ${messageLogId}
    ORDER BY edited_at DESC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    messageLogId: Number(r.message_log_id),
    previousText: (r.previous_text as string) ?? null,
    previousTranscript: (r.previous_transcript as string) ?? null,
    editedAt: r.edited_at as Date,
  }));
}

// "Owner active in this chat" for the grace window means the owner
// actually typed something in Telegram — NOT the bot's own AI/auto reply
// (those land in messages_log with from_owner=TRUE because Telegram
// attributes business outgoing to the user). Bot-generated rows have a
// non-null `source` (ai_chat, auto_reply, friendly_reply, bot_echo,
// ai_dashboard, owner_dashboard, ...) so we ignore anything with a
// source set. Owner-typed messages from the Telegram client are logged
// with source IS NULL.
export async function lastOwnerMessageAt(chatId: number): Promise<Date | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT MAX(created_at) AS at FROM messages_log
    WHERE chat_id = ${chatId}
      AND from_owner = TRUE
      AND source IS NULL`;
  const r = rows[0] as { at: Date | null } | undefined;
  return r?.at ?? null;
}

export type MessageRow = {
  id: number;
  createdAt: Date;
  businessConnectionId: string;
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  senderId: number | null;
  senderName: string;
  senderUsername: string | null;
  messageId: number;
  messageText: string;
  importance: number;
  urgent: boolean;
  concernsOwner: boolean;
  reason: string;
  alerted: boolean;
  autoReplied: boolean;
  handledAt: Date | null;
  handledBy: number | null;
  notes: string | null;
  mediaKind: string | null;
  mediaFileId: string | null;
  transcript: string | null;
  transcriptAt: Date | null;
  mediaDescription: string | null;
  mediaDescriptionAt: Date | null;
  otpCode: string | null;
  deletedAt: Date | null;
  editedAt: Date | null;
  editCount: number;
  fromOwner: boolean;
  source: string | null;
  chatMode: ChatMode;
  // Per-chat custom labels from chat_rules — when present, the UI
  // should prefer these over senderName (which is the raw Telegram-
  // supplied first name). Only filled for DMs / chats where the
  // operator has labelled the chat.
  chatFirstName: string | null;
  chatLastName: string | null;
  chatNickname: string | null;
  inlineButtons: Array<{ label: string; url: string }> | null;
};

function rowToMessage(r: Record<string, unknown>): MessageRow {
  return {
    id: Number(r.id),
    createdAt: r.created_at as Date,
    businessConnectionId: r.business_connection_id as string,
    chatId: Number(r.chat_id),
    chatType: r.chat_type as string,
    chatTitle: (r.chat_title as string) ?? null,
    senderId: r.sender_id != null ? Number(r.sender_id) : null,
    senderName: r.sender_name as string,
    senderUsername: (r.sender_username as string) ?? null,
    messageId: Number(r.message_id),
    messageText: r.message_text as string,
    importance: Number(r.importance),
    urgent: r.urgent as boolean,
    concernsOwner: r.concerns_owner as boolean,
    reason: r.reason as string,
    alerted: r.alerted as boolean,
    autoReplied: r.auto_replied as boolean,
    handledAt: (r.handled_at as Date) ?? null,
    handledBy: r.handled_by != null ? Number(r.handled_by) : null,
    notes: (r.notes as string) ?? null,
    mediaKind: (r.media_kind as string) ?? null,
    mediaFileId: (r.media_file_id as string) ?? null,
    transcript: (r.transcript as string) ?? null,
    transcriptAt: (r.transcript_at as Date) ?? null,
    mediaDescription: (r.media_description as string) ?? null,
    mediaDescriptionAt: (r.media_description_at as Date) ?? null,
    otpCode: (r.otp_code as string) ?? null,
    deletedAt: (r.deleted_at as Date) ?? null,
    editedAt: (r.edited_at as Date) ?? null,
    editCount:
      r.edit_count != null ? Number(r.edit_count) : 0,
    fromOwner: Boolean(r.from_owner),
    source: (r.source as string) ?? null,
    chatMode:
      (CHAT_MODES.includes((r.chat_mode as ChatMode) ?? "secretary")
        ? (r.chat_mode as ChatMode)
        : "secretary"),
    chatFirstName: (r.chat_rule_first_name as string) ?? null,
    chatLastName: (r.chat_rule_last_name as string) ?? null,
    chatNickname: (r.chat_rule_nickname as string) ?? null,
    inlineButtons: parseInlineButtons(r.inline_buttons),
  };
}

function parseInlineButtons(
  raw: unknown,
): Array<{ label: string; url: string }> | null {
  if (!raw) return null;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  const out: Array<{ label: string; url: string }> = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const it = item as { label?: unknown; url?: unknown };
    const label = typeof it.label === "string" ? it.label : "";
    const url = typeof it.url === "string" ? it.url : "";
    if (label && url) out.push({ label, url });
  }
  return out.length > 0 ? out : null;
}

export async function listMessages(opts: {
  urgentOnly?: boolean;
  unhandledOnly?: boolean;
  chatId?: number;
  search?: string;
  kind?: "all" | "deleted" | "edited";
  limit?: number;
  offset?: number;
}): Promise<MessageRow[]> {
  await ensureSchema();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = sql();
  const search = opts.search ? `%${opts.search}%` : null;
  const kind = opts.kind ?? "all";
  const onlyDeleted = kind === "deleted";
  const onlyEdited = kind === "edited";
  const rows = await q`
    SELECT m.*, COALESCE(r.mode, 'secretary') AS chat_mode,
           r.first_name AS chat_rule_first_name,
           r.last_name  AS chat_rule_last_name,
           r.nickname   AS chat_rule_nickname,
           (SELECT COUNT(*)::int FROM message_edits e WHERE e.message_log_id = m.id) AS edit_count
    FROM messages_log m
    LEFT JOIN chat_rules r ON r.chat_id = m.chat_id
    WHERE (${opts.urgentOnly ?? false}::boolean = FALSE OR m.urgent = TRUE)
      AND (${opts.unhandledOnly ?? false}::boolean = FALSE OR m.handled_at IS NULL)
      AND (${opts.chatId ?? null}::bigint IS NULL OR m.chat_id = ${opts.chatId ?? null}::bigint)
      AND (${search}::text IS NULL OR m.message_text ILIKE ${search} OR m.sender_name ILIKE ${search})
      AND (${onlyDeleted}::boolean = FALSE OR m.deleted_at IS NOT NULL)
      AND (
        ${onlyEdited}::boolean = FALSE
        OR EXISTS (SELECT 1 FROM message_edits e WHERE e.message_log_id = m.id)
      )
    ORDER BY m.created_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  return rows.map(rowToMessage);
}

// --- Thread summaries ---

export type ThreadSummary = {
  id: number;
  chatId: number;
  threadStartedAt: Date;
  threadEndedAt: Date;
  messageCount: number;
  summary: string;
  topics: string[];
  actionItems: string[];
  createdAt: Date;
};

function rowToThreadSummary(r: Record<string, unknown>): ThreadSummary {
  const topicsRaw = r.topics;
  const actionsRaw = r.action_items;
  return {
    id: Number(r.id),
    chatId: Number(r.chat_id),
    threadStartedAt: r.thread_started_at as Date,
    threadEndedAt: r.thread_ended_at as Date,
    messageCount: Number(r.message_count),
    summary: r.summary as string,
    topics: Array.isArray(topicsRaw)
      ? (topicsRaw.filter((x) => typeof x === "string") as string[])
      : [],
    actionItems: Array.isArray(actionsRaw)
      ? (actionsRaw.filter((x) => typeof x === "string") as string[])
      : [],
    createdAt: r.created_at as Date,
  };
}

// Record where we posted the summary, so a reply to that message in
// the summary_inbox can be routed back to the source chat. Called
// after sendMessage to the inbox returns the new message id.
export async function setThreadSummaryInbox(args: {
  chatId: number;
  threadStartedAt: Date;
  inboxChatId: number;
  inboxMessageId: number;
}): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE thread_summaries
    SET inbox_chat_id = ${args.inboxChatId},
        inbox_message_id = ${args.inboxMessageId}
    WHERE chat_id = ${args.chatId}
      AND thread_started_at = ${args.threadStartedAt.toISOString()}`;
}

// Look up the source chat for a reply that landed in the
// summary_inbox. Used by the channel-post / inbox-reply handler.
export async function findThreadByInboxMessage(
  inboxChatId: number,
  inboxMessageId: number,
): Promise<{ chatId: number; threadStartedAt: Date } | null> {
  if (!hasDb()) return null;
  const rows = await sql()`
    SELECT chat_id, thread_started_at
    FROM thread_summaries
    WHERE inbox_chat_id = ${inboxChatId}
      AND inbox_message_id = ${inboxMessageId}
    LIMIT 1`;
  const r = rows[0] as
    | { chat_id: string; thread_started_at: Date }
    | undefined;
  if (!r) return null;
  return {
    chatId: Number(r.chat_id),
    threadStartedAt: r.thread_started_at,
  };
}

export async function upsertThreadSummary(args: {
  chatId: number;
  threadStartedAt: Date;
  threadEndedAt: Date;
  messageCount: number;
  summary: string;
  topics: string[];
  actionItems: string[];
}): Promise<ThreadSummary> {
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO thread_summaries (
      chat_id, thread_started_at, thread_ended_at, message_count,
      summary, topics, action_items
    ) VALUES (
      ${args.chatId}, ${args.threadStartedAt.toISOString()},
      ${args.threadEndedAt.toISOString()}, ${args.messageCount},
      ${args.summary},
      ${JSON.stringify(args.topics)}::jsonb,
      ${JSON.stringify(args.actionItems)}::jsonb
    )
    ON CONFLICT (chat_id, thread_started_at) DO UPDATE SET
      thread_ended_at = EXCLUDED.thread_ended_at,
      message_count = EXCLUDED.message_count,
      summary = EXCLUDED.summary,
      topics = EXCLUDED.topics,
      action_items = EXCLUDED.action_items,
      created_at = NOW()
    RETURNING id, chat_id, thread_started_at, thread_ended_at,
              message_count, summary, topics, action_items, created_at`;
  return rowToThreadSummary(rows[0] as Record<string, unknown>);
}

export async function listThreadSummaries(
  chatId: number,
  threadStartedAts: Date[],
): Promise<ThreadSummary[]> {
  if (!hasDb() || threadStartedAts.length === 0) return [];
  await ensureSchema();
  const isoList = threadStartedAts.map((d) => d.toISOString());
  const rows = await sql()`
    SELECT id, chat_id, thread_started_at, thread_ended_at,
           message_count, summary, topics, action_items, created_at
    FROM thread_summaries
    WHERE chat_id = ${chatId}
      AND thread_started_at = ANY(${isoList}::timestamptz[])`;
  return (rows as Array<Record<string, unknown>>).map(rowToThreadSummary);
}

// Cluster a chat's messages into threads by time gap (default: a >5min
// silence starts a new thread). Used by the ai_listen mode dashboard so
// the owner can scan what happened during periods they weren't looking
// at the chat. Returns one row per message, tagged with the thread it
// belongs to; callers group by threadNo client-side.
export type ThreadedMessageRow = MessageRow & { threadNo: number };

export async function listChatThreaded(opts: {
  chatId: number;
  gapMinutes?: number;
  limit?: number;
}): Promise<ThreadedMessageRow[]> {
  await ensureSchema();
  const gap = Math.max(1, Math.min(opts.gapMinutes ?? 5, 240));
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  const rows = await sql()`
    WITH ordered AS (
      SELECT m.*, LAG(m.created_at) OVER (ORDER BY m.created_at) AS prev_at
      FROM messages_log m
      WHERE m.chat_id = ${opts.chatId}
        AND COALESCE(m.skipped_reason, '') <> 'muted'
    ),
    flagged AS (
      SELECT *,
        CASE
          WHEN prev_at IS NULL
            OR EXTRACT(EPOCH FROM (created_at - prev_at)) > ${gap * 60}
          THEN 1 ELSE 0
        END AS is_new_thread
      FROM ordered
    ),
    numbered AS (
      SELECT *,
        SUM(is_new_thread) OVER (ORDER BY created_at) AS thread_no
      FROM flagged
    ),
    latest_threads AS (
      SELECT DISTINCT thread_no
      FROM numbered
      ORDER BY thread_no DESC
      LIMIT 30
    )
    SELECT n.*, COALESCE(r.mode, 'off') AS chat_mode
    FROM numbered n
    LEFT JOIN chat_rules r ON r.chat_id = n.chat_id
    WHERE n.thread_no IN (SELECT thread_no FROM latest_threads)
    ORDER BY n.created_at DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    ...rowToMessage(r),
    threadNo: Number((r as { thread_no: number }).thread_no),
  }));
}

export async function markMessageHandled(
  id: number,
  actorId: number,
  notes?: string,
): Promise<void> {
  await ensureSchema();
  await sql()`
    UPDATE messages_log
    SET handled_at = NOW(), handled_by = ${actorId},
        notes = COALESCE(${notes ?? null}, notes)
    WHERE id = ${id}`;
}

export async function bulkMarkMessagesHandled(
  ids: number[],
  actorId: number,
  handled: boolean,
): Promise<number> {
  if (!hasDb() || ids.length === 0) return 0;
  await ensureSchema();
  const rows = handled
    ? await sql()`
        UPDATE messages_log
        SET handled_at = NOW(), handled_by = ${actorId}
        WHERE id = ANY(${ids}::bigint[])
        RETURNING id`
    : await sql()`
        UPDATE messages_log
        SET handled_at = NULL, handled_by = NULL
        WHERE id = ANY(${ids}::bigint[])
        RETURNING id`;
  return rows.length;
}

export async function unhandleMessage(id: number): Promise<void> {
  await ensureSchema();
  await sql()`UPDATE messages_log SET handled_at = NULL, handled_by = NULL WHERE id = ${id}`;
}

export async function overviewStats(): Promise<{
  totalMessages: number;
  urgentTotal: number;
  urgentUnhandled: number;
  alertsLast24h: number;
  autoRepliesLast24h: number;
  connections: number;
  groupSummariesLast7d: number;
}> {
  await ensureSchema();
  const q = sql();
  const [tot, urgTot, urgPend, alerts24, replies24, conns, summ7] = await Promise.all([
    q`SELECT COUNT(*)::bigint AS n FROM messages_log`,
    q`SELECT COUNT(*)::bigint AS n FROM messages_log WHERE urgent = TRUE`,
    q`SELECT COUNT(*)::bigint AS n FROM messages_log WHERE urgent = TRUE AND handled_at IS NULL`,
    q`SELECT COUNT(*)::bigint AS n FROM messages_log WHERE alerted = TRUE AND created_at > NOW() - INTERVAL '24 hours'`,
    q`SELECT COUNT(*)::bigint AS n FROM messages_log WHERE auto_replied = TRUE AND created_at > NOW() - INTERVAL '24 hours'`,
    q`SELECT COUNT(*)::bigint AS n FROM business_connections WHERE is_enabled = TRUE`,
    q`SELECT COUNT(*)::bigint AS n FROM group_summaries WHERE created_at > NOW() - INTERVAL '7 days'`,
  ]);
  const num = (rows: unknown): number =>
    Number((rows as Array<{ n: string }>)[0]?.n ?? 0);
  return {
    totalMessages: num(tot),
    urgentTotal: num(urgTot),
    urgentUnhandled: num(urgPend),
    alertsLast24h: num(alerts24),
    autoRepliesLast24h: num(replies24),
    connections: num(conns),
    groupSummariesLast7d: num(summ7),
  };
}

// --- Chat rules ---

export type ChatMode =
  | "off"
  | "secretary"
  | "auto_reply"
  | "friendly_reply"
  | "ai_chat"
  | "ai_listen";

export const CHAT_MODES: ChatMode[] = [
  "off",
  "secretary",
  "auto_reply",
  "friendly_reply",
  "ai_chat",
  "ai_listen",
];

export const RELATIONSHIPS = [
  "close_family",
  "family",
  "close_friend",
  "friend",
  "work_acquaintance",
  "employer",
  "formal",
  "suspicious",
  "stranger",
] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

// Role / function a chat plays in the owner's workflow. Most chats are
// just conversations (null), but some are tools or feeds whose
// behaviour the bot should adapt to.
export const FUNCTION_ROLES = [
  "downloader",
  "sms_inbox",
  "download_archive",
  "news",
  "summary_inbox",
  "storage",
  "voice_storage",
  "video_note_storage",
  "video_storage",
  "photo_storage",
  "notes_inbox",
] as const;
export type FunctionRole = (typeof FUNCTION_ROLES)[number];

export const FUNCTION_ROLE_LABELS: Record<FunctionRole, string> = {
  downloader:
    "Downloader bot (Instagram / YouTube / Twitter / SoundCloud / Spotify)",
  sms_inbox: "SMS inbox (forwarded phone messages)",
  download_archive: "Download archive (saved Instagram / etc. media)",
  news: "News source (channel or group with important news)",
  summary_inbox:
    "Summary inbox (channel/group that receives auto-summaries from ai_listen chats)",
  storage:
    "Storage (channel that receives Instagram stories / posts / reels via HikerAPI)",
  voice_storage:
    "Voice storage (auto-forwarded voice messages). Inline 📝 button transcribes in-place.",
  video_note_storage:
    "Video-note storage (round video bubbles). Inline 📝 button transcribes in-place. Falls back to voice_storage if not set.",
  video_storage:
    "Video storage (auto-forwarded regular videos from chats with auto_forward_video)",
  photo_storage:
    "Photo storage (auto-forwarded photos from chats with auto_forward_photo)",
  notes_inbox:
    "Notes inbox (auto-extracted addresses, locations, contacts and key points from chats with auto_extract_notes)",
};

export type ChatRule = {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  vip: boolean;
  muted: boolean;
  customReply: string | null;
  notes: string | null;
  mode: ChatMode;
  modeChangedAt: Date;
  secretaryUserId: number | null;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  relationship: Relationship | null;
  relationshipNotes: string | null;
  talkStyleNotes: string | null;
  toneProfile: string | null;
  toneProfileAt: Date | null;
  floodCooldownUntil: Date | null;
  floodDeflectedAt: Date | null;
  aiProcessVoice: boolean;
  aiProcessStickers: boolean;
  aiProcessGifs: boolean;
  aiProcessPhotos: boolean;
  aiProcessVideoNotes: boolean;
  aiGeneratePhoto: boolean;
  functionRole: FunctionRole | null;
  functionConfig: Record<string, unknown> | null;
  autoSummarizeEnabled: boolean;
  autoSummarizeGapMinutes: number;
  autoSummarizeSmartTiming: boolean;
  lastAutoSummaryAt: Date | null;
  autoForwardVoice: boolean;
  autoForwardVideo: boolean;
  autoForwardPhoto: boolean;
  autoForwardLocation: boolean;
  autoExtractNotes: boolean;
  isBot: boolean;
  ignored: boolean;
  phoneNumber: string | null;
  graceSkippedAt: Date | null;
  // Per-chat cadence for the daily-summary cron. NULL = use the cron
  // default (24h). When set, the cron also tracks lastSummaryRunAt so
  // it can skip chats that aren't due yet.
  summaryIntervalHours: number | null;
  lastSummaryRunAt: Date | null;
  // Public read-only token for the /share/groups/<token> analytics
  // page. Operator generates/revokes via the Share button on
  // /groups/<chatId>.
  analyticsShareToken: string | null;
  // Follow-up reminder fields — set per-chat, defaulted by the
  // schema (enabled=TRUE, threshold=2h, escalate=12h).
  followUpEnabled: boolean;
  followUpThresholdHours: number;
  followUpEscalateHours: number;
  followUpLastPingAt: Date | null;
  followUpLastPingKind: string | null;
  followUpAckedAt: Date | null;
  updatedAt: Date;
};

function rowToChatRule(r: Record<string, unknown>): ChatRule {
  const mode = (r.mode as string) ?? "off";
  const rel = (r.relationship as string) ?? null;
  return {
    chatId: Number(r.chat_id),
    chatType: r.chat_type as string,
    chatTitle: (r.chat_title as string) ?? null,
    vip: r.vip as boolean,
    muted: r.muted as boolean,
    customReply: (r.custom_reply as string) ?? null,
    notes: (r.notes as string) ?? null,
    mode: (CHAT_MODES.includes(mode as ChatMode) ? mode : "off") as ChatMode,
    modeChangedAt:
      (r.mode_changed_at as Date) ?? (r.updated_at as Date) ?? new Date(),
    secretaryUserId:
      r.secretary_user_id != null ? Number(r.secretary_user_id) : null,
    firstName: (r.first_name as string) ?? null,
    lastName: (r.last_name as string) ?? null,
    nickname: (r.nickname as string) ?? null,
    relationship:
      rel && (RELATIONSHIPS as readonly string[]).includes(rel)
        ? (rel as Relationship)
        : null,
    relationshipNotes: (r.relationship_notes as string) ?? null,
    talkStyleNotes: (r.talk_style_notes as string) ?? null,
    toneProfile: (r.tone_profile as string) ?? null,
    toneProfileAt: (r.tone_profile_at as Date) ?? null,
    floodCooldownUntil: (r.flood_cooldown_until as Date) ?? null,
    floodDeflectedAt: (r.flood_deflected_at as Date) ?? null,
    aiProcessVoice: Boolean(r.ai_process_voice),
    aiProcessStickers: Boolean(r.ai_process_stickers),
    aiProcessGifs: Boolean(r.ai_process_gifs),
    aiProcessPhotos: Boolean(r.ai_process_photos),
    aiProcessVideoNotes: Boolean(r.ai_process_video_notes),
    aiGeneratePhoto: Boolean(r.ai_generate_photo),
    functionRole:
      typeof r.function_role === "string" &&
      (FUNCTION_ROLES as readonly string[]).includes(r.function_role)
        ? (r.function_role as FunctionRole)
        : null,
    functionConfig:
      r.function_config && typeof r.function_config === "object"
        ? (r.function_config as Record<string, unknown>)
        : null,
    autoSummarizeEnabled: Boolean(r.auto_summarize_enabled),
    autoSummarizeGapMinutes:
      Number(r.auto_summarize_gap_minutes) > 0
        ? Number(r.auto_summarize_gap_minutes)
        : 5,
    autoSummarizeSmartTiming:
      r.auto_summarize_smart_timing == null
        ? true
        : Boolean(r.auto_summarize_smart_timing),
    lastAutoSummaryAt: (r.last_auto_summary_at as Date) ?? null,
    autoForwardVoice: Boolean(r.auto_forward_voice),
    autoForwardVideo: Boolean(r.auto_forward_video),
    autoForwardPhoto: Boolean(r.auto_forward_photo),
    autoForwardLocation: Boolean(r.auto_forward_location),
    autoExtractNotes: Boolean(r.auto_extract_notes),
    isBot: Boolean(r.is_bot),
    ignored: Boolean(r.ignored),
    phoneNumber: (r.phone_number as string) ?? null,
    graceSkippedAt: (r.grace_skipped_at as Date) ?? null,
    summaryIntervalHours:
      r.summary_interval_hours != null
        ? Number(r.summary_interval_hours)
        : null,
    lastSummaryRunAt: (r.last_summary_run_at as Date) ?? null,
    analyticsShareToken: (r.analytics_share_token as string) ?? null,
    followUpEnabled:
      r.follow_up_enabled == null ? true : Boolean(r.follow_up_enabled),
    followUpThresholdHours:
      r.follow_up_threshold_hours != null
        ? Number(r.follow_up_threshold_hours)
        : 2,
    followUpEscalateHours:
      r.follow_up_escalate_hours != null
        ? Number(r.follow_up_escalate_hours)
        : 12,
    followUpLastPingAt: (r.follow_up_last_ping_at as Date) ?? null,
    followUpLastPingKind: (r.follow_up_last_ping_kind as string) ?? null,
    followUpAckedAt: (r.follow_up_acked_at as Date) ?? null,
    updatedAt: r.updated_at as Date,
  };
}

export async function getChatRule(chatId: number): Promise<ChatRule | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT chat_id, chat_type, chat_title, vip, muted, custom_reply, notes,
           mode, mode_changed_at, secretary_user_id,
           first_name, last_name, nickname, relationship,
           relationship_notes, talk_style_notes,
           tone_profile, tone_profile_at,
           flood_cooldown_until, flood_deflected_at,
           ai_process_voice, ai_process_stickers, ai_process_gifs, ai_process_photos,
           ai_process_video_notes, ai_generate_photo,
           function_role, function_config,
           auto_summarize_enabled, auto_summarize_gap_minutes,
           auto_summarize_smart_timing,
           last_auto_summary_at,
           auto_forward_voice, auto_forward_video, auto_forward_photo,
           auto_forward_location, auto_extract_notes,
           is_bot, ignored, phone_number,
           grace_skipped_at,
           summary_interval_hours, last_summary_run_at, analytics_share_token,
           follow_up_enabled, follow_up_threshold_hours, follow_up_escalate_hours,
           follow_up_last_ping_at, follow_up_last_ping_kind, follow_up_acked_at,
           updated_at
    FROM chat_rules WHERE chat_id = ${chatId} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToChatRule(r) : null;
}

export async function upsertChatRule(rule: {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  vip: boolean;
  muted: boolean;
  customReply: string | null;
  notes: string | null;
  mode?: ChatMode;
  secretaryUserId?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
  relationship?: Relationship | null;
  relationshipNotes?: string | null;
  talkStyleNotes?: string | null;
  aiProcessVoice?: boolean;
  aiProcessStickers?: boolean;
  aiProcessGifs?: boolean;
  aiProcessPhotos?: boolean;
  aiProcessVideoNotes?: boolean;
  aiGeneratePhoto?: boolean;
  functionRole?: FunctionRole | null;
  functionConfig?: Record<string, unknown> | null;
}): Promise<void> {
  await ensureSchema();
  const mode = rule.mode ?? "off";
  const secretaryUserId = rule.secretaryUserId ?? null;
  const firstName = rule.firstName ?? null;
  const lastName = rule.lastName ?? null;
  const nickname = rule.nickname ?? null;
  const relationship =
    rule.relationship &&
    (RELATIONSHIPS as readonly string[]).includes(rule.relationship)
      ? rule.relationship
      : null;
  const relationshipNotes = rule.relationshipNotes ?? null;
  const talkStyleNotes = rule.talkStyleNotes ?? null;
  const aiProcessVoice = rule.aiProcessVoice ?? false;
  const aiProcessStickers = rule.aiProcessStickers ?? false;
  const aiProcessGifs = rule.aiProcessGifs ?? false;
  const aiProcessPhotos = rule.aiProcessPhotos ?? false;
  const aiProcessVideoNotes = rule.aiProcessVideoNotes ?? false;
  const aiGeneratePhoto = rule.aiGeneratePhoto ?? false;
  const functionRole =
    rule.functionRole &&
    (FUNCTION_ROLES as readonly string[]).includes(rule.functionRole)
      ? rule.functionRole
      : null;
  const functionConfigJson =
    rule.functionConfig === undefined
      ? undefined
      : rule.functionConfig === null
        ? null
        : JSON.stringify(rule.functionConfig);
  await sql()`
    INSERT INTO chat_rules (
      chat_id, chat_type, chat_title, vip, muted, custom_reply, notes,
      mode, mode_changed_at, secretary_user_id,
      first_name, last_name, nickname, relationship,
      relationship_notes, talk_style_notes,
      ai_process_voice, ai_process_stickers, ai_process_gifs, ai_process_photos,
      ai_process_video_notes, ai_generate_photo,
      function_role, function_config, updated_at
    )
    VALUES (
      ${rule.chatId}, ${rule.chatType}, ${rule.chatTitle}, ${rule.vip}, ${rule.muted},
      ${rule.customReply}, ${rule.notes}, ${mode}, NOW(), ${secretaryUserId},
      ${firstName}, ${lastName}, ${nickname}, ${relationship},
      ${relationshipNotes}, ${talkStyleNotes},
      ${aiProcessVoice}, ${aiProcessStickers}, ${aiProcessGifs}, ${aiProcessPhotos},
      ${aiProcessVideoNotes}, ${aiGeneratePhoto},
      ${functionRole}, ${functionConfigJson}::jsonb, NOW()
    )
    ON CONFLICT (chat_id) DO UPDATE SET
      -- chat_type is authoritative from messages_log (written on every
      -- msg ingest). Don't let an API edit clobber it with a stale or
      -- guessed value — only adopt EXCLUDED.chat_type when the existing
      -- row has none (shouldn't happen since the column is NOT NULL,
      -- but kept defensive).
      chat_type = COALESCE(chat_rules.chat_type, EXCLUDED.chat_type),
      chat_title = COALESCE(EXCLUDED.chat_title, chat_rules.chat_title),
      vip = EXCLUDED.vip,
      muted = EXCLUDED.muted,
      custom_reply = EXCLUDED.custom_reply,
      notes = EXCLUDED.notes,
      mode = EXCLUDED.mode,
      mode_changed_at = CASE WHEN chat_rules.mode IS DISTINCT FROM EXCLUDED.mode
                              THEN NOW() ELSE chat_rules.mode_changed_at END,
      secretary_user_id = EXCLUDED.secretary_user_id,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      nickname = EXCLUDED.nickname,
      relationship = EXCLUDED.relationship,
      relationship_notes = EXCLUDED.relationship_notes,
      talk_style_notes = EXCLUDED.talk_style_notes,
      ai_process_voice = EXCLUDED.ai_process_voice,
      ai_process_stickers = EXCLUDED.ai_process_stickers,
      ai_process_gifs = EXCLUDED.ai_process_gifs,
      ai_process_photos = EXCLUDED.ai_process_photos,
      ai_process_video_notes = EXCLUDED.ai_process_video_notes,
      ai_generate_photo = EXCLUDED.ai_generate_photo,
      function_role = COALESCE(EXCLUDED.function_role, chat_rules.function_role),
      function_config = COALESCE(EXCLUDED.function_config, chat_rules.function_config),
      updated_at = NOW()`;
}

// Manual override of the auto-detected is_bot flag (auto-detection
// flags chats whose senders have usernames ending in "bot", which
// covers most cases but the owner needs the escape hatch). Separate
// helper because upsertChatRule's `undefined` couldn't distinguish
// "don't touch" from "set to false".
export async function setChatIsBot(
  chatId: number,
  isBot: boolean,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title, is_bot, updated_at)
    VALUES (
      ${chatId},
      COALESCE(
        (SELECT MAX(chat_type) FROM messages_log WHERE chat_id = ${chatId}),
        CASE WHEN ${chatId}::bigint < 0 THEN 'supergroup' ELSE 'private' END
      ),
      (SELECT MAX(chat_title) FROM messages_log WHERE chat_id = ${chatId}),
      ${isBot},
      NOW()
    )
    ON CONFLICT (chat_id) DO UPDATE SET
      is_bot = ${isBot},
      updated_at = NOW()`;
}

export async function setChatFunction(
  chatId: number,
  role: FunctionRole | null,
  config: Record<string, unknown> | null,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const normalisedRole =
    role && (FUNCTION_ROLES as readonly string[]).includes(role) ? role : null;
  const configJson = config ? JSON.stringify(config) : null;
  // Fresh channels/groups may not have a chat_rules row yet, so a
  // plain UPDATE would silently noop and the role would never stick.
  // Derive chat_type/title from messages_log if any rows exist, else
  // guess from the chat_id sign (positive = private, negative = group/
  // channel). Telegram channel/supergroup IDs are < 0 so this is reliable.
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title, function_role, function_config, updated_at)
    VALUES (
      ${chatId},
      COALESCE(
        (SELECT MAX(chat_type) FROM messages_log WHERE chat_id = ${chatId}),
        CASE WHEN ${chatId}::bigint < 0 THEN 'supergroup' ELSE 'private' END
      ),
      (SELECT MAX(chat_title) FROM messages_log WHERE chat_id = ${chatId}),
      ${normalisedRole},
      ${configJson}::jsonb,
      NOW()
    )
    ON CONFLICT (chat_id) DO UPDATE SET
      function_role = ${normalisedRole},
      function_config = ${configJson}::jsonb,
      updated_at = NOW()`;
}

// Bulk versions for the chats list page. Each is INSERT-from-
// messages_log ON CONFLICT so chats that don't yet have a chat_rules
// row (never edited) still get one. chat_type is required by the
// schema so we pull it from messages_log.
export async function bulkSetChatMode(
  chatIds: number[],
  mode: ChatMode,
): Promise<number> {
  if (!hasDb() || chatIds.length === 0) return 0;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title, mode, mode_changed_at, updated_at)
    SELECT m.chat_id, MAX(m.chat_type), MAX(m.chat_title), ${mode}, NOW(), NOW()
    FROM messages_log m
    WHERE m.chat_id = ANY(${chatIds}::bigint[])
    GROUP BY m.chat_id
    ON CONFLICT (chat_id) DO UPDATE SET
      mode = EXCLUDED.mode,
      mode_changed_at = NOW(),
      updated_at = NOW()
    RETURNING chat_id`;
  return rows.length;
}

export async function bulkSetChatFlag(
  chatIds: number[],
  flag: "vip" | "muted",
  value: boolean,
): Promise<number> {
  if (!hasDb() || chatIds.length === 0) return 0;
  await ensureSchema();
  // VIP and muted are mutually exclusive in our UI — turning one ON
  // turns the other OFF.
  if (flag === "vip") {
    const rows = await sql()`
      INSERT INTO chat_rules (chat_id, chat_type, chat_title, vip, muted, updated_at)
      SELECT m.chat_id, MAX(m.chat_type), MAX(m.chat_title), ${value},
             CASE WHEN ${value} THEN FALSE ELSE FALSE END, NOW()
      FROM messages_log m
      WHERE m.chat_id = ANY(${chatIds}::bigint[])
      GROUP BY m.chat_id
      ON CONFLICT (chat_id) DO UPDATE SET
        vip = EXCLUDED.vip,
        muted = CASE WHEN ${value} THEN FALSE ELSE chat_rules.muted END,
        updated_at = NOW()
      RETURNING chat_id`;
    return rows.length;
  }
  const rows = await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title, vip, muted, updated_at)
    SELECT m.chat_id, MAX(m.chat_type), MAX(m.chat_title),
           CASE WHEN ${value} THEN FALSE ELSE FALSE END, ${value}, NOW()
    FROM messages_log m
    WHERE m.chat_id = ANY(${chatIds}::bigint[])
    GROUP BY m.chat_id
    ON CONFLICT (chat_id) DO UPDATE SET
      muted = EXCLUDED.muted,
      vip = CASE WHEN ${value} THEN FALSE ELSE chat_rules.vip END,
      updated_at = NOW()
    RETURNING chat_id`;
  return rows.length;
}

export async function bulkSetChatFunction(
  chatIds: number[],
  role: FunctionRole | null,
): Promise<number> {
  if (!hasDb() || chatIds.length === 0) return 0;
  await ensureSchema();
  const normalisedRole =
    role && (FUNCTION_ROLES as readonly string[]).includes(role) ? role : null;
  const rows = await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title, function_role, updated_at)
    SELECT m.chat_id, MAX(m.chat_type), MAX(m.chat_title), ${normalisedRole}, NOW()
    FROM messages_log m
    WHERE m.chat_id = ANY(${chatIds}::bigint[])
    GROUP BY m.chat_id
    ON CONFLICT (chat_id) DO UPDATE SET
      function_role = EXCLUDED.function_role,
      updated_at = NOW()
    RETURNING chat_id`;
  return rows.length;
}

export async function bulkSetAutoSummarize(
  chatIds: number[],
  enabled: boolean,
  gapMinutes: number,
  smartTiming: boolean = true,
): Promise<number> {
  if (!hasDb() || chatIds.length === 0) return 0;
  await ensureSchema();
  const gap = Math.max(1, Math.min(Math.round(gapMinutes), 240));
  const rows = await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title,
                            auto_summarize_enabled, auto_summarize_gap_minutes,
                            auto_summarize_smart_timing,
                            updated_at)
    SELECT m.chat_id, MAX(m.chat_type), MAX(m.chat_title),
           ${enabled}, ${gap}, ${smartTiming}, NOW()
    FROM messages_log m
    WHERE m.chat_id = ANY(${chatIds}::bigint[])
    GROUP BY m.chat_id
    ON CONFLICT (chat_id) DO UPDATE SET
      auto_summarize_enabled = ${enabled},
      auto_summarize_gap_minutes = ${gap},
      auto_summarize_smart_timing = ${smartTiming},
      updated_at = NOW()
    RETURNING chat_id`;
  return rows.length;
}

// Toggle auto-summary for a chat (typically called when the owner
// flips the checkbox in /chats/[id]). Stays separate from upsertChatRule
// so the JSON of an unrelated edit doesn't accidentally reset it.
export async function setAutoSummarize(
  chatId: number,
  enabled: boolean,
  gapMinutes: number,
  smartTiming: boolean = true,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const gap = Math.max(1, Math.min(Math.round(gapMinutes), 240));
  // Same trick as setChatFunction: bootstrap a chat_rules row from
  // messages_log (or default to "private") so a plain UPDATE doesn't
  // noop when no row exists yet.
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title,
                            auto_summarize_enabled, auto_summarize_gap_minutes,
                            auto_summarize_smart_timing, updated_at)
    VALUES (
      ${chatId},
      COALESCE(
        (SELECT MAX(chat_type) FROM messages_log WHERE chat_id = ${chatId}),
        CASE WHEN ${chatId}::bigint < 0 THEN 'supergroup' ELSE 'private' END
      ),
      (SELECT MAX(chat_title) FROM messages_log WHERE chat_id = ${chatId}),
      ${enabled},
      ${gap},
      ${smartTiming},
      NOW()
    )
    ON CONFLICT (chat_id) DO UPDATE SET
      auto_summarize_enabled = ${enabled},
      auto_summarize_gap_minutes = ${gap},
      auto_summarize_smart_timing = ${smartTiming},
      updated_at = NOW()`;
}

export type ChatAutomationPatch = {
  autoForwardVoice?: boolean;
  autoForwardVideo?: boolean;
  autoForwardPhoto?: boolean;
  autoForwardLocation?: boolean;
  autoExtractNotes?: boolean;
};

export async function setChatAutomation(
  chatId: number,
  patch: ChatAutomationPatch,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  // Don't default chat_type to 'private' — Telegram channels and
  // supergroups have negative IDs and DEFINITELY aren't DMs. Look up
  // the real type from the first messages_log row for this chat; if
  // we can't find one (no history yet), guess from the id (negative
  // = supergroup, positive = private).
  const guessed = chatId < 0 ? "supergroup" : "private";
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type,
      auto_forward_voice, auto_forward_video, auto_forward_photo,
      auto_forward_location, auto_extract_notes, updated_at)
    VALUES (${chatId},
      COALESCE(
        (SELECT chat_type FROM messages_log WHERE chat_id = ${chatId} LIMIT 1),
        ${guessed}
      ),
      ${patch.autoForwardVoice ?? false},
      ${patch.autoForwardVideo ?? false},
      ${patch.autoForwardPhoto ?? false},
      ${patch.autoForwardLocation ?? false},
      ${patch.autoExtractNotes ?? false},
      NOW())
    ON CONFLICT (chat_id) DO UPDATE SET
      auto_forward_voice = COALESCE(${patch.autoForwardVoice ?? null}::boolean, chat_rules.auto_forward_voice),
      auto_forward_video = COALESCE(${patch.autoForwardVideo ?? null}::boolean, chat_rules.auto_forward_video),
      auto_forward_photo = COALESCE(${patch.autoForwardPhoto ?? null}::boolean, chat_rules.auto_forward_photo),
      auto_forward_location = COALESCE(${patch.autoForwardLocation ?? null}::boolean, chat_rules.auto_forward_location),
      auto_extract_notes = COALESCE(${patch.autoExtractNotes ?? null}::boolean, chat_rules.auto_extract_notes),
      updated_at = NOW()`;
}

export async function bulkSetChatAutomation(
  chatIds: number[],
  patch: ChatAutomationPatch,
): Promise<number> {
  if (!hasDb() || chatIds.length === 0) return 0;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title,
      auto_forward_voice, auto_forward_video, auto_forward_photo,
      auto_forward_location, auto_extract_notes, updated_at)
    SELECT m.chat_id, MAX(m.chat_type), MAX(m.chat_title),
           ${patch.autoForwardVoice ?? false},
           ${patch.autoForwardVideo ?? false},
           ${patch.autoForwardPhoto ?? false},
           ${patch.autoForwardLocation ?? false},
           ${patch.autoExtractNotes ?? false},
           NOW()
    FROM messages_log m
    WHERE m.chat_id = ANY(${chatIds}::bigint[])
    GROUP BY m.chat_id
    ON CONFLICT (chat_id) DO UPDATE SET
      auto_forward_voice = COALESCE(${patch.autoForwardVoice ?? null}::boolean, chat_rules.auto_forward_voice),
      auto_forward_video = COALESCE(${patch.autoForwardVideo ?? null}::boolean, chat_rules.auto_forward_video),
      auto_forward_photo = COALESCE(${patch.autoForwardPhoto ?? null}::boolean, chat_rules.auto_forward_photo),
      auto_forward_location = COALESCE(${patch.autoForwardLocation ?? null}::boolean, chat_rules.auto_forward_location),
      auto_extract_notes = COALESCE(${patch.autoExtractNotes ?? null}::boolean, chat_rules.auto_extract_notes),
      updated_at = NOW()
    RETURNING chat_id`;
  return rows.length;
}

// --- Chat notes ---

export type ChatNote = {
  id: number;
  chatId: number;
  tenantId: number | null;
  sourceMessageId: number | null;
  kind: string;
  title: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
  senderName: string | null;
  archivedAt: Date | null;
  createdAt: Date;
};

function rowToChatNote(r: Record<string, unknown>): ChatNote {
  return {
    id: Number(r.id),
    chatId: Number(r.chat_id),
    tenantId: r.tenant_id == null ? null : Number(r.tenant_id),
    sourceMessageId:
      r.source_message_id == null ? null : Number(r.source_message_id),
    kind: r.kind as string,
    title: (r.title as string) ?? null,
    content: r.content as string,
    metadata:
      r.metadata && typeof r.metadata === "object"
        ? (r.metadata as Record<string, unknown>)
        : null,
    senderName: (r.sender_name as string) ?? null,
    archivedAt: (r.archived_at as Date) ?? null,
    createdAt: r.created_at as Date,
  };
}

export async function addChatNote(args: {
  chatId: number;
  tenantId?: number | null;
  sourceMessageId?: number | null;
  kind: string;
  title?: string | null;
  content: string;
  metadata?: Record<string, unknown> | null;
  senderName?: string | null;
}): Promise<ChatNote | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO chat_notes (chat_id, tenant_id, source_message_id, kind, title, content, metadata, sender_name)
    VALUES (${args.chatId}, ${args.tenantId ?? null},
            ${args.sourceMessageId ?? null}, ${args.kind},
            ${args.title ?? null}, ${args.content},
            ${args.metadata ? JSON.stringify(args.metadata) : null}::jsonb,
            ${args.senderName ?? null})
    RETURNING id, chat_id, tenant_id, source_message_id, kind, title, content,
              metadata, sender_name, archived_at, created_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToChatNote(r) : null;
}

export async function listChatNotes(opts: {
  chatId?: number;
  tenantId?: number | null;
  kind?: string;
  includeArchived?: boolean;
  limit?: number;
}): Promise<ChatNote[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, chat_id, tenant_id, source_message_id, kind, title, content,
           metadata, sender_name, archived_at, created_at
    FROM chat_notes
    WHERE (${opts.chatId ?? null}::bigint IS NULL OR chat_id = ${opts.chatId ?? null})
      AND (${opts.tenantId ?? null}::bigint IS NULL OR tenant_id = ${opts.tenantId ?? null})
      AND (${opts.kind ?? null}::text IS NULL OR kind = ${opts.kind ?? null})
      AND (${opts.includeArchived ?? false}::boolean OR archived_at IS NULL)
    ORDER BY created_at DESC
    LIMIT ${opts.limit ?? 200}`;
  return (rows as Array<Record<string, unknown>>).map(rowToChatNote);
}

// Per-chat aggregate counts — used by the /notes index ("X notes from
// chat Y, mostly addresses"). Returns one row per chat with totals.
export async function chatNoteSummaryByChat(
  tenantId?: number | null,
): Promise<Array<{
  chatId: number;
  total: number;
  byKind: Record<string, number>;
  lastNoteAt: Date;
}>> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT chat_id,
           COUNT(*)::int AS total,
           MAX(created_at) AS last_note_at,
           jsonb_object_agg(kind, kind_count) AS by_kind
    FROM (
      SELECT chat_id, kind, COUNT(*)::int AS kind_count, MAX(created_at) AS created_at
      FROM chat_notes
      WHERE archived_at IS NULL
        AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})
      GROUP BY chat_id, kind
    ) g
    GROUP BY chat_id
    ORDER BY last_note_at DESC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    chatId: Number(r.chat_id),
    total: Number(r.total),
    byKind:
      r.by_kind && typeof r.by_kind === "object"
        ? (Object.fromEntries(
            Object.entries(r.by_kind as Record<string, unknown>).map(
              ([k, v]) => [k, Number(v)],
            ),
          ) as Record<string, number>)
        : {},
    lastNoteAt: r.last_note_at as Date,
  }));
}

export async function deleteChatNote(id: number): Promise<boolean> {
  if (!hasDb()) return false;
  const rows = await sql()`DELETE FROM chat_notes WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

export async function archiveChatNote(
  id: number,
  archived: boolean,
): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE chat_notes
    SET archived_at = CASE WHEN ${archived}::boolean THEN NOW() ELSE NULL END
    WHERE id = ${id}`;
}

// --- Media routing log ---

export type MediaRoutingDecision =
  | "routed" // voice/video/photo copied to target storage chat
  | "no_rule" // source chat has no chat_rules row
  | "flag_off" // auto_forward_* is false on the source chat
  | "muted" // source chat muted, so we skip routing
  | "no_target" // no chat tagged with the target role
  | "error" // sendXxx call threw
  | "received_business" // diagnostic: media reached handleBusinessMessage
  | "received_group" // diagnostic: media reached handleAnyChatPost
  | "received_secretary" // diagnostic: media reached handleSecretaryReply
  | "received_edit" // diagnostic: media reached handleBusinessEdit
  | "skipped_bot_echo" // diagnostic: returned at the sender_business_bot guard
  | "skipped_no_owner" // diagnostic: resolveOwner returned null
  | "skipped_owner_self" // diagnostic: entered the owner-self branch but
  //                          maybeRouteMedia was NOT called from here yet
  | "passed_to_router" // diagnostic: about to call maybeRouteMedia
  | "skipped_no_bcid" // diagnostic: business_message without business_connection_id
  | "skipped_no_content"; // diagnostic: hasContent guard returned false

export type MediaRoutingLogEntry = {
  id: number;
  sourceChatId: number;
  sourceMessageId: number | null;
  kind: string;
  decision: MediaRoutingDecision;
  targetRole: string | null;
  targetChatId: number | null;
  targetMessageId: number | null;
  error: string | null;
  createdAt: Date;
};

export async function logMediaRouting(args: {
  sourceChatId: number;
  sourceMessageId?: number | null;
  kind: string;
  decision: MediaRoutingDecision;
  targetRole?: string | null;
  targetChatId?: number | null;
  targetMessageId?: number | null;
  error?: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    INSERT INTO media_routing_log (
      source_chat_id, source_message_id, kind, decision,
      target_role, target_chat_id, target_message_id, error
    )
    VALUES (${args.sourceChatId}, ${args.sourceMessageId ?? null},
            ${args.kind}, ${args.decision},
            ${args.targetRole ?? null}, ${args.targetChatId ?? null},
            ${args.targetMessageId ?? null}, ${args.error ?? null})`;
}

export async function listMediaRoutingLog(opts: {
  chatId?: number | null;
  decision?: MediaRoutingDecision;
  limit?: number;
} = {}): Promise<MediaRoutingLogEntry[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, source_chat_id, source_message_id, kind, decision,
           target_role, target_chat_id, target_message_id, error, created_at
    FROM media_routing_log
    WHERE (${opts.chatId ?? null}::bigint IS NULL OR source_chat_id = ${opts.chatId ?? null})
      AND (${opts.decision ?? null}::text IS NULL OR decision = ${opts.decision ?? null})
    ORDER BY created_at DESC
    LIMIT ${opts.limit ?? 200}`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    sourceChatId: Number(r.source_chat_id),
    sourceMessageId:
      r.source_message_id == null ? null : Number(r.source_message_id),
    kind: r.kind as string,
    decision: r.decision as MediaRoutingDecision,
    targetRole: (r.target_role as string) ?? null,
    targetChatId: r.target_chat_id == null ? null : Number(r.target_chat_id),
    targetMessageId:
      r.target_message_id == null ? null : Number(r.target_message_id),
    error: (r.error as string) ?? null,
    createdAt: r.created_at as Date,
  }));
}

export async function markAutoSummaryDelivered(chatId: number): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE chat_rules
    SET last_auto_summary_at = NOW(), updated_at = NOW()
    WHERE chat_id = ${chatId}`;
}

export async function saveOtpCode(
  messageLogId: number,
  code: string,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE messages_log
    SET otp_code = ${code}
    WHERE id = ${messageLogId}`;
}

// Save a phone → identity mapping observed from a Telegram contact
// share. Idempotent on (phone_tail, telegram_user_id) — repeated
// shares only refresh observed_at + names.
export async function recordPhoneContact(args: {
  phoneFull: string;
  telegramUserId?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  source?: string;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const digits = args.phoneFull.replace(/\D/g, "");
  if (digits.length < 6) return;
  const tail = digits.slice(-9);
  // Existing row with same tail + user_id (or both with null user)?
  const existing = await sql()`
    SELECT id FROM phone_contacts
    WHERE phone_tail = ${tail}
      AND COALESCE(telegram_user_id, 0) = COALESCE(${args.telegramUserId ?? null}, 0)
    LIMIT 1`;
  if ((existing as unknown[]).length > 0) {
    await sql()`
      UPDATE phone_contacts
      SET observed_at = NOW(),
          first_name = COALESCE(${args.firstName ?? null}, first_name),
          last_name  = COALESCE(${args.lastName ?? null}, last_name),
          username   = COALESCE(${args.username ?? null}, username),
          phone_full = ${args.phoneFull}
      WHERE id = ${Number((existing[0] as { id: string }).id)}`;
    return;
  }
  await sql()`
    INSERT INTO phone_contacts (
      phone_full, phone_tail, telegram_user_id, first_name, last_name, username, source
    ) VALUES (
      ${args.phoneFull}, ${tail}, ${args.telegramUserId ?? null},
      ${args.firstName ?? null}, ${args.lastName ?? null}, ${args.username ?? null},
      ${args.source ?? "contact_share"}
    )`;
}

// Lookup a phone tail → best-known identity. Prefers entries with a
// telegram_user_id (we actually know the user) over name-only ones.
export async function lookupPhoneContact(phone: string): Promise<{
  name: string | null;
  telegramUserId: number | null;
  username: string | null;
} | null> {
  if (!hasDb() || !phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return null;
  const tail = digits.slice(-9);
  await ensureSchema();
  const rows = await sql()`
    SELECT first_name, last_name, username, telegram_user_id
    FROM phone_contacts
    WHERE phone_tail = ${tail}
    ORDER BY (telegram_user_id IS NOT NULL) DESC, observed_at DESC
    LIMIT 1`;
  const r = rows[0] as
    | {
        first_name: string | null;
        last_name: string | null;
        username: string | null;
        telegram_user_id: string | number | null;
      }
    | undefined;
  if (!r) return null;
  const name =
    [r.first_name, r.last_name].filter(Boolean).join(" ").trim() ||
    r.username ||
    null;
  return {
    name,
    telegramUserId: r.telegram_user_id == null ? null : Number(r.telegram_user_id),
    username: r.username,
  };
}

// Best-guess identity for a phone number, based on past messages
// the bot has logged. Tries a few strategies in priority order:
//   1. chat_rules row whose notes/relationship_notes mention the
//      number tail (operator manually labelled them).
//   2. messages_log row mentioning the number tail — most-mentioning
//      chat wins; uses the chat's first_name/last_name/nickname.
// Returns null when nothing matches; the SMS forwarder then falls
// back to "☎️ +PHONE" with no name.
export async function findOwnerOfPhone(phone: string): Promise<{
  name: string | null;
  chatId: number | null;
} | null> {
  if (!phone || !hasDb()) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return null;
  // Use the LAST 8 digits so "+989121234567" and "09121234567" both
  // match "121234567" (Iran mobile mid-section). Long enough to be
  // distinctive but tolerant of country code variations.
  const tail = digits.slice(-8);
  await ensureSchema();
  // Strategy 0a: operator-entered chat_rules.phone_number — most
  // authoritative because the operator typed it specifically to
  // bind this person ↔ this number. We match on the same 8-digit
  // tail used elsewhere.
  const phoneRows = await sql()`
    SELECT chat_id, first_name, last_name, nickname
    FROM chat_rules
    WHERE phone_number IS NOT NULL
      AND regexp_replace(phone_number, '\\D', '', 'g') LIKE ${`%${tail}`}
    LIMIT 1`;
  if ((phoneRows as unknown[]).length > 0) {
    const r = phoneRows[0] as Record<string, unknown>;
    const name =
      [r.first_name, r.last_name].filter(Boolean).join(" ").trim() ||
      (r.nickname as string) ||
      null;
    return { name: name || null, chatId: Number(r.chat_id) };
  }
  // Strategy 0b: phone_contacts table populated from harvested
  // contact shares — most reliable identity source we have because
  // it carries an actual telegram_user_id when available.
  const phoneHit = await lookupPhoneContact(phone).catch(() => null);
  if (phoneHit?.name) {
    return { name: phoneHit.name, chatId: phoneHit.telegramUserId };
  }
  // Earlier revisions also fell back to ILIKE scans over
  // chat_rules.notes and messages_log.message_text but both turned
  // out to be noisy in practice — random conversations that
  // happened to contain the same 9 digits ("زهرا شیخ", an SMS
  // aggregator channel, …) kept winning the tiebreak and getting
  // stamped on every forward. We now refuse to guess: if there's no
  // operator-typed phone binding AND no harvested contact share,
  // return null so the caller can fall back to the webhook's own
  // sourceLabel.
  return null;
}

export type SmsWebhook = {
  id: number;
  name: string;
  secret: string;
  enabled: boolean;
  kind: "sms" | "insta";
  lastUsedAt: Date | null;
  createdAt: Date;
};

function rowToSmsWebhook(r: Record<string, unknown>): SmsWebhook {
  const rawKind = (r.kind as string) ?? "sms";
  return {
    id: Number(r.id),
    name: r.name as string,
    secret: r.secret as string,
    enabled: Boolean(r.enabled),
    kind: rawKind === "insta" ? "insta" : "sms",
    lastUsedAt: (r.last_used_at as Date) ?? null,
    createdAt: r.created_at as Date,
  };
}

export async function listSmsWebhooks(args?: {
  kind?: "sms" | "insta";
}): Promise<SmsWebhook[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const kindFilter = args?.kind ?? null;
  const rows = await sql()`
    SELECT id, name, secret, enabled, kind, last_used_at, created_at
    FROM sms_webhooks
    WHERE (${kindFilter}::text IS NULL OR kind = ${kindFilter}::text)
    ORDER BY created_at DESC`;
  return (rows as Array<Record<string, unknown>>).map(rowToSmsWebhook);
}

export async function createSmsWebhook(args: {
  name: string;
  secret: string;
  kind?: "sms" | "insta";
}): Promise<SmsWebhook> {
  if (!hasDb()) throw new Error("DATABASE_URL not set");
  await ensureSchema();
  const kind = args.kind ?? "sms";
  const rows = await sql()`
    INSERT INTO sms_webhooks (name, secret, kind)
    VALUES (${args.name}, ${args.secret}, ${kind})
    RETURNING id, name, secret, enabled, kind, last_used_at, created_at`;
  return rowToSmsWebhook(rows[0] as Record<string, unknown>);
}

export async function updateSmsWebhook(
  id: number,
  patch: Partial<{ name: string; enabled: boolean }>,
): Promise<SmsWebhook | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    UPDATE sms_webhooks SET
      name = COALESCE(${patch.name ?? null}, name),
      enabled = COALESCE(${patch.enabled ?? null}::boolean, enabled)
    WHERE id = ${id}
    RETURNING id, name, secret, enabled, kind, last_used_at, created_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToSmsWebhook(r) : null;
}

export async function deleteSmsWebhook(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM sms_webhooks WHERE id = ${id}`;
}

export async function findSmsWebhookBySecret(
  secret: string,
  kind?: "sms" | "insta",
): Promise<SmsWebhook | null> {
  if (!hasDb() || !secret) return null;
  await ensureSchema();
  const kindFilter = kind ?? null;
  const rows = await sql()`
    SELECT id, name, secret, enabled, kind, last_used_at, created_at
    FROM sms_webhooks
    WHERE secret = ${secret} AND enabled = TRUE
      AND (${kindFilter}::text IS NULL OR kind = ${kindFilter}::text)
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToSmsWebhook(r) : null;
}

export async function touchSmsWebhook(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`UPDATE sms_webhooks SET last_used_at = NOW() WHERE id = ${id}`;
}

// --- SMS dedup ---

export type SmsDedupRow = {
  id: number;
  inboxChatId: number;
  bodySignature: string;
  bodyPreview: string | null;
  firstSentAt: Date;
  lastSeenAt: Date;
  repeatCount: number;
  telegramMessageId: number | null;
};

// Stable signature for dedup. Strips whitespace + lowercases + drops
// per-message dynamic tokens (long digit runs ≥ 4) so two ad blasts
// that only differ in a tracking code coalesce. Short numbers (years,
// times) survive.
export function smsBodySignature(body: string): string {
  let s = body.toLowerCase().trim();
  s = s.replace(/[\s‌]+/g, " ");
  s = s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  s = s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  // Replace any digit run of 4+ with #### so dynamic codes don't
  // defeat dedup but short years like 2026 still match.
  s = s.replace(/\d{4,}/g, "####");
  return s.slice(0, 800);
}

export async function findSmsDedup(
  inboxChatId: number,
  signature: string,
  withinHours: number,
): Promise<SmsDedupRow | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, inbox_chat_id, body_signature, body_preview,
           first_sent_at, last_seen_at, repeat_count, telegram_message_id
    FROM sms_dedup
    WHERE inbox_chat_id = ${inboxChatId}
      AND body_signature = ${signature}
      AND last_seen_at > NOW() - make_interval(hours => ${withinHours})
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    inboxChatId: Number(r.inbox_chat_id),
    bodySignature: r.body_signature as string,
    bodyPreview: (r.body_preview as string) ?? null,
    firstSentAt: r.first_sent_at as Date,
    lastSeenAt: r.last_seen_at as Date,
    repeatCount: Number(r.repeat_count),
    telegramMessageId:
      r.telegram_message_id != null ? Number(r.telegram_message_id) : null,
  };
}

export async function upsertSmsDedup(args: {
  inboxChatId: number;
  bodySignature: string;
  bodyPreview: string;
  telegramMessageId: number | null;
}): Promise<SmsDedupRow> {
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO sms_dedup (inbox_chat_id, body_signature, body_preview, telegram_message_id)
    VALUES (${args.inboxChatId}, ${args.bodySignature},
            ${args.bodyPreview.slice(0, 400)}, ${args.telegramMessageId})
    ON CONFLICT (inbox_chat_id, body_signature) DO UPDATE SET
      last_seen_at = NOW(),
      repeat_count = sms_dedup.repeat_count + 1,
      telegram_message_id = COALESCE(EXCLUDED.telegram_message_id,
                                     sms_dedup.telegram_message_id)
    RETURNING id, inbox_chat_id, body_signature, body_preview,
              first_sent_at, last_seen_at, repeat_count, telegram_message_id`;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: Number(r.id),
    inboxChatId: Number(r.inbox_chat_id),
    bodySignature: r.body_signature as string,
    bodyPreview: (r.body_preview as string) ?? null,
    firstSentAt: r.first_sent_at as Date,
    lastSeenAt: r.last_seen_at as Date,
    repeatCount: Number(r.repeat_count),
    telegramMessageId:
      r.telegram_message_id != null ? Number(r.telegram_message_id) : null,
  };
}

export async function setSmsDedupMessageId(
  dedupId: number,
  telegramMessageId: number,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE sms_dedup SET telegram_message_id = ${telegramMessageId}
    WHERE id = ${dedupId}`;
}

export async function getSmsDedup(
  dedupId: number,
): Promise<SmsDedupRow | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, inbox_chat_id, body_signature, body_preview,
           first_sent_at, last_seen_at, repeat_count, telegram_message_id
    FROM sms_dedup WHERE id = ${dedupId} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    inboxChatId: Number(r.inbox_chat_id),
    bodySignature: r.body_signature as string,
    bodyPreview: (r.body_preview as string) ?? null,
    firstSentAt: r.first_sent_at as Date,
    lastSeenAt: r.last_seen_at as Date,
    repeatCount: Number(r.repeat_count),
    telegramMessageId:
      r.telegram_message_id != null ? Number(r.telegram_message_id) : null,
  };
}

export async function deleteSmsDedup(dedupId: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM sms_dedup WHERE id = ${dedupId}`;
}

// --- SMS block rules ---

export type SmsBlockRule = {
  id: number;
  exampleBody: string;
  label: string | null;
  enabled: boolean;
  hitCount: number;
  lastHitAt: Date | null;
  createdAt: Date;
  createdBy: number | null;
};

function rowToSmsBlockRule(r: Record<string, unknown>): SmsBlockRule {
  return {
    id: Number(r.id),
    exampleBody: r.example_body as string,
    label: (r.label as string) ?? null,
    enabled: Boolean(r.enabled),
    hitCount: Number(r.hit_count ?? 0),
    lastHitAt: (r.last_hit_at as Date) ?? null,
    createdAt: r.created_at as Date,
    createdBy: r.created_by != null ? Number(r.created_by) : null,
  };
}

export async function listSmsBlockRules(args?: {
  enabledOnly?: boolean;
}): Promise<SmsBlockRule[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const enabledOnly = args?.enabledOnly ?? false;
  const rows = await sql()`
    SELECT id, example_body, label, enabled, hit_count, last_hit_at,
           created_at, created_by
    FROM sms_block_rules
    WHERE (${enabledOnly}::boolean = FALSE OR enabled = TRUE)
    ORDER BY created_at DESC`;
  return (rows as Array<Record<string, unknown>>).map(rowToSmsBlockRule);
}

export async function createSmsBlockRule(args: {
  exampleBody: string;
  label?: string | null;
  createdBy?: number | null;
}): Promise<SmsBlockRule> {
  if (!hasDb()) throw new Error("DATABASE_URL not set");
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO sms_block_rules (example_body, label, created_by)
    VALUES (${args.exampleBody}, ${args.label ?? null}, ${args.createdBy ?? null})
    RETURNING id, example_body, label, enabled, hit_count, last_hit_at,
              created_at, created_by`;
  return rowToSmsBlockRule(rows[0] as Record<string, unknown>);
}

export async function updateSmsBlockRule(
  id: number,
  patch: Partial<{ label: string | null; enabled: boolean }>,
): Promise<SmsBlockRule | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const labelMarker = patch.label === undefined ? 0 : 1;
  const labelValue = patch.label ?? null;
  const rows = await sql()`
    UPDATE sms_block_rules SET
      label = CASE WHEN ${labelMarker}::int = 1 THEN ${labelValue} ELSE label END,
      enabled = COALESCE(${patch.enabled ?? null}::boolean, enabled)
    WHERE id = ${id}
    RETURNING id, example_body, label, enabled, hit_count, last_hit_at,
              created_at, created_by`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToSmsBlockRule(r) : null;
}

export async function deleteSmsBlockRule(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM sms_block_rules WHERE id = ${id}`;
}

export async function touchSmsBlockRule(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE sms_block_rules
    SET hit_count = hit_count + 1, last_hit_at = NOW()
    WHERE id = ${id}`;
}

// --- SMS accept signatures ---

export async function addSmsAcceptSignature(args: {
  bodySignature: string;
  bodyPreview: string;
  createdBy?: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO sms_accept_signatures (body_signature, body_preview, created_by)
    VALUES (${args.bodySignature}, ${args.bodyPreview.slice(0, 400)},
            ${args.createdBy ?? null})
    ON CONFLICT (body_signature) DO NOTHING`;
}

export async function isSmsAcceptedSignature(
  signature: string,
): Promise<boolean> {
  if (!hasDb() || !signature) return false;
  await ensureSchema();
  const rows = await sql()`
    SELECT 1 FROM sms_accept_signatures
    WHERE body_signature = ${signature}
    LIMIT 1`;
  return rows.length > 0;
}

export async function touchSmsAcceptSignature(
  signature: string,
): Promise<void> {
  if (!hasDb() || !signature) return;
  await ensureSchema();
  await sql()`
    UPDATE sms_accept_signatures
    SET hit_count = hit_count + 1, last_hit_at = NOW()
    WHERE body_signature = ${signature}`;
}

// --- Group analytics cache + share token ---

export type GroupAnalyticsCache = {
  chatId: number;
  chatTitle: string | null;
  windowDays: number;
  sinceIso: string;
  messageCount: number;
  analysis: unknown;
  createdAt: Date;
};

function rowToGroupAnalyticsCache(
  r: Record<string, unknown>,
): GroupAnalyticsCache {
  return {
    chatId: Number(r.chat_id),
    chatTitle: (r.chat_title as string) ?? null,
    windowDays: Number(r.window_days),
    sinceIso: r.since_iso as string,
    messageCount: Number(r.message_count),
    analysis: r.analysis,
    createdAt: r.created_at as Date,
  };
}

export async function getCachedGroupAnalytics(
  chatId: number,
  windowDays: number,
): Promise<GroupAnalyticsCache | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT chat_id, chat_title, window_days, since_iso, message_count, analysis, created_at
    FROM group_analytics
    WHERE chat_id = ${chatId} AND window_days = ${windowDays}
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToGroupAnalyticsCache(r) : null;
}

export async function upsertGroupAnalytics(args: {
  chatId: number;
  chatTitle: string | null;
  windowDays: number;
  sinceIso: string;
  messageCount: number;
  analysis: unknown;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO group_analytics (chat_id, chat_title, window_days, since_iso, message_count, analysis)
    VALUES (${args.chatId}, ${args.chatTitle}, ${args.windowDays}, ${args.sinceIso},
            ${args.messageCount}, ${JSON.stringify(args.analysis)}::jsonb)
    ON CONFLICT (chat_id, window_days) DO UPDATE SET
      chat_title = EXCLUDED.chat_title,
      since_iso = EXCLUDED.since_iso,
      message_count = EXCLUDED.message_count,
      analysis = EXCLUDED.analysis,
      created_at = NOW()`;
}

export async function getGroupAnalyticsShareToken(
  chatId: number,
): Promise<string | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT analytics_share_token FROM chat_rules WHERE chat_id = ${chatId} LIMIT 1`;
  const r = rows[0] as { analytics_share_token: string | null } | undefined;
  return r?.analytics_share_token ?? null;
}

export async function setGroupAnalyticsShareToken(args: {
  chatId: number;
  token: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  // Make sure a chat_rules row exists for this chat so the UPDATE
  // actually hits. The defaults match other code paths that touch
  // chat_rules without a full rule setup.
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, analytics_share_token)
    VALUES (${args.chatId}, 'group', ${args.token})
    ON CONFLICT (chat_id) DO UPDATE SET
      analytics_share_token = ${args.token},
      updated_at = NOW()`;
}

export async function findChatByAnalyticsShareToken(
  token: string,
): Promise<{ chatId: number; chatTitle: string | null } | null> {
  if (!hasDb() || !token) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT chat_id, chat_title FROM chat_rules
    WHERE analytics_share_token = ${token} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    chatId: Number(r.chat_id),
    chatTitle: (r.chat_title as string) ?? null,
  };
}

// --- Follow-up reminders ---

// Set per-chat follow-up settings. Each field is independently
// patchable so the UI can toggle enabled, set threshold, or mark
// the operator's acknowledgement without overwriting siblings.
export async function setChatFollowUp(args: {
  chatId: number;
  enabled?: boolean;
  thresholdHours?: number | null;
  escalateHours?: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO chat_rules (
      chat_id, chat_type, follow_up_enabled, follow_up_threshold_hours,
      follow_up_escalate_hours
    )
    VALUES (
      ${args.chatId}, 'private',
      ${args.enabled ?? true},
      ${args.thresholdHours ?? 2},
      ${args.escalateHours ?? 12}
    )
    ON CONFLICT (chat_id) DO UPDATE SET
      follow_up_enabled = COALESCE(${args.enabled ?? null}::boolean,
                                   chat_rules.follow_up_enabled),
      follow_up_threshold_hours = COALESCE(${args.thresholdHours ?? null}::numeric,
                                           chat_rules.follow_up_threshold_hours),
      follow_up_escalate_hours = COALESCE(${args.escalateHours ?? null}::numeric,
                                          chat_rules.follow_up_escalate_hours),
      updated_at = NOW()`;
}

// Mark this chat as "I'm aware" — bot stops sending more follow-up
// pings until the customer messages again. Stamped by the "متوجه
// شدم" button under each follow-up notice in notes_inbox.
export async function ackChatFollowUp(chatId: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE chat_rules
    SET follow_up_acked_at = NOW(), updated_at = NOW()
    WHERE chat_id = ${chatId}`;
}

export async function recordChatFollowUpPing(args: {
  chatId: number;
  kind: "first" | "escalate";
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE chat_rules
    SET follow_up_last_ping_at = NOW(),
        follow_up_last_ping_kind = ${args.kind},
        updated_at = NOW()
    WHERE chat_id = ${args.chatId}`;
}

export type FollowUpCandidate = {
  chatId: number;
  chatTitle: string | null;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  thresholdHours: number;
  escalateHours: number;
  lastPingAt: Date | null;
  lastPingKind: string | null;
  ackedAt: Date | null;
  lastCustomerMessageAt: Date;
  lastCustomerMessageText: string;
  lastOwnerMessageAt: Date | null;
  pendingCustomerMessageCount: number;
};

// Scan ALL private chats and return the ones that meet either of:
//   - first ping condition: customer sent something more than
//     threshold hours ago, owner hasn't replied since, AND we
//     haven't already pinged for this stretch.
//   - escalate condition: we already pinged "first" more than
//     escalate hours ago and the owner is STILL silent.
//
// The follow-up cron walks this list each tick and posts to
// notes_inbox.
export async function listFollowUpCandidates(args?: {
  tenantId?: number | null;
}): Promise<FollowUpCandidate[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const tenantId = args?.tenantId ?? null;
  const rows = await sql()`
    WITH msg_per_chat AS (
      SELECT
        m.chat_id,
        MAX(CASE WHEN m.from_owner THEN m.created_at END) AS last_owner_at,
        MAX(CASE WHEN NOT m.from_owner THEN m.created_at END) AS last_customer_at
      FROM messages_log m
      WHERE m.chat_type = 'private'
        AND m.created_at > NOW() - INTERVAL '365 days'
        AND COALESCE(m.skipped_reason, '') <> 'muted'
        AND (${tenantId}::bigint IS NULL OR m.tenant_id = ${tenantId})
      GROUP BY m.chat_id
    ),
    rx_per_chat AS (
      SELECT chat_id, MAX(reacted_at) AS last_reaction_at
      FROM owner_reactions
      WHERE reacted_at > NOW() - INTERVAL '365 days'
        AND (${tenantId}::bigint IS NULL OR tenant_id = ${tenantId})
      GROUP BY chat_id
    ),
    per_chat AS (
      SELECT
        m.chat_id,
        GREATEST(m.last_owner_at, r.last_reaction_at) AS last_owner_at,
        m.last_customer_at
      FROM msg_per_chat m
      LEFT JOIN rx_per_chat r ON r.chat_id = m.chat_id
    ),
    candidate AS (
      SELECT p.chat_id, p.last_owner_at, p.last_customer_at,
             r.first_name, r.last_name, r.nickname, r.chat_title,
             r.follow_up_enabled, r.follow_up_threshold_hours,
             r.follow_up_escalate_hours,
             r.follow_up_last_ping_at, r.follow_up_last_ping_kind,
             r.follow_up_acked_at
      FROM per_chat p
      LEFT JOIN chat_rules r ON r.chat_id = p.chat_id
      WHERE p.last_customer_at IS NOT NULL
        AND (p.last_owner_at IS NULL OR p.last_owner_at < p.last_customer_at)
        AND COALESCE(r.follow_up_enabled, TRUE) = TRUE
        AND COALESCE(r.muted, FALSE) = FALSE
        AND COALESCE(r.ignored, FALSE) = FALSE
        -- Don't bother chats where the bot is itself / is_bot
        AND COALESCE(r.is_bot, FALSE) = FALSE
        -- ack window: if the operator pressed "متوجه شدم" after the
        -- last customer message, don't ping again until a NEW
        -- customer message comes in (acked > last_customer = silence).
        AND (
          r.follow_up_acked_at IS NULL
          OR r.follow_up_acked_at < p.last_customer_at
        )
    )
    SELECT c.*,
           EXTRACT(EPOCH FROM (NOW() - c.last_customer_at)) / 3600.0 AS hours_since_customer,
           CASE
             WHEN c.follow_up_last_ping_at IS NULL THEN NULL
             ELSE EXTRACT(EPOCH FROM (NOW() - c.follow_up_last_ping_at)) / 3600.0
           END AS hours_since_ping
    FROM candidate c
    WHERE
      -- First ping not sent yet AND we're past the threshold.
      (
        c.follow_up_last_ping_at IS NULL
        AND EXTRACT(EPOCH FROM (NOW() - c.last_customer_at)) / 3600.0
            >= COALESCE(c.follow_up_threshold_hours, 2)
      )
      OR
      -- First ping sent, owner still silent, escalate threshold elapsed.
      (
        c.follow_up_last_ping_at IS NOT NULL
        AND c.follow_up_last_ping_kind = 'first'
        AND EXTRACT(EPOCH FROM (NOW() - c.follow_up_last_ping_at)) / 3600.0
            >= COALESCE(c.follow_up_escalate_hours, 12)
      )
    ORDER BY c.last_customer_at ASC
    LIMIT 50`;
  const out: FollowUpCandidate[] = [];
  for (const r0 of rows as Array<Record<string, unknown>>) {
    const chatId = Number(r0.chat_id);
    // Pull a quick summary: count of customer messages since the
    // owner's last reply, plus the latest customer text.
    const lastOwnerAt = (r0.last_owner_at as Date) ?? null;
    const summaryRows = await sql()`
      SELECT COUNT(*)::int AS cnt,
             (ARRAY_AGG(message_text ORDER BY created_at DESC))[1] AS last_text
      FROM messages_log
      WHERE chat_id = ${chatId}
        AND from_owner = FALSE
        AND COALESCE(skipped_reason, '') <> 'muted'
        AND created_at > COALESCE(${
          lastOwnerAt ? lastOwnerAt.toISOString() : null
        }::timestamptz, NOW() - INTERVAL '365 days')`;
    const s = summaryRows[0] as
      | { cnt: number; last_text: string | null }
      | undefined;
    out.push({
      chatId,
      chatTitle: (r0.chat_title as string) ?? null,
      firstName: (r0.first_name as string) ?? null,
      lastName: (r0.last_name as string) ?? null,
      nickname: (r0.nickname as string) ?? null,
      thresholdHours: Number(r0.follow_up_threshold_hours ?? 2),
      escalateHours: Number(r0.follow_up_escalate_hours ?? 12),
      lastPingAt: (r0.follow_up_last_ping_at as Date) ?? null,
      lastPingKind: (r0.follow_up_last_ping_kind as string) ?? null,
      ackedAt: (r0.follow_up_acked_at as Date) ?? null,
      lastCustomerMessageAt: r0.last_customer_at as Date,
      lastCustomerMessageText: (s?.last_text as string) ?? "",
      lastOwnerMessageAt: lastOwnerAt,
      pendingCustomerMessageCount: Number(s?.cnt ?? 1),
    });
  }
  return out;
}

// Debug-only counterpart to listFollowUpCandidates: returns ALL
// private chats with a "decided" reason describing exactly which
// gate fired (or "would_ping_first" / "would_ping_escalate" when
// the chat is a real candidate). Used by the cron's ?debug=1 mode
// so the operator can see why a specific chat isn't being pinged.
export type FollowUpDebugRow = {
  chatId: number;
  chatTitle: string | null;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  lastCustomerMessageAt: Date | null;
  lastOwnerMessageAt: Date | null;
  hoursSinceCustomer: number | null;
  followUpEnabled: boolean;
  thresholdHours: number;
  escalateHours: number;
  lastPingAt: Date | null;
  lastPingKind: string | null;
  ackedAt: Date | null;
  muted: boolean;
  ignored: boolean;
  isBot: boolean;
  decided: string;
};

export async function debugFollowUpScan(args?: {
  tenantId?: number | null;
}): Promise<FollowUpDebugRow[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const tenantId = args?.tenantId ?? null;
  const rows = await sql()`
    WITH msg_per_chat AS (
      SELECT
        m.chat_id,
        MAX(CASE WHEN m.from_owner THEN m.created_at END) AS last_owner_at,
        MAX(CASE WHEN NOT m.from_owner THEN m.created_at END) AS last_customer_at
      FROM messages_log m
      WHERE m.chat_type = 'private'
        AND m.created_at > NOW() - INTERVAL '365 days'
        AND COALESCE(m.skipped_reason, '') <> 'muted'
        AND (${tenantId}::bigint IS NULL OR m.tenant_id = ${tenantId})
      GROUP BY m.chat_id
    ),
    rx_per_chat AS (
      SELECT chat_id, MAX(reacted_at) AS last_reaction_at
      FROM owner_reactions
      WHERE reacted_at > NOW() - INTERVAL '365 days'
        AND (${tenantId}::bigint IS NULL OR tenant_id = ${tenantId})
      GROUP BY chat_id
    ),
    per_chat AS (
      SELECT
        m.chat_id,
        GREATEST(m.last_owner_at, r.last_reaction_at) AS last_owner_at,
        m.last_customer_at
      FROM msg_per_chat m
      LEFT JOIN rx_per_chat r ON r.chat_id = m.chat_id
    )
    SELECT
      p.chat_id, p.last_owner_at, p.last_customer_at,
      r.first_name, r.last_name, r.nickname, r.chat_title,
      COALESCE(r.follow_up_enabled, TRUE) AS follow_up_enabled,
      COALESCE(r.follow_up_threshold_hours, 2) AS threshold_h,
      COALESCE(r.follow_up_escalate_hours, 12) AS escalate_h,
      r.follow_up_last_ping_at, r.follow_up_last_ping_kind,
      r.follow_up_acked_at,
      COALESCE(r.muted, FALSE) AS muted,
      COALESCE(r.ignored, FALSE) AS ignored,
      COALESCE(r.is_bot, FALSE) AS is_bot,
      CASE
        WHEN p.last_customer_at IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (NOW() - p.last_customer_at)) / 3600.0
      END AS hours_since_customer,
      CASE
        WHEN p.last_customer_at IS NULL THEN 'no_customer_message'
        WHEN p.last_owner_at IS NOT NULL AND p.last_owner_at >= p.last_customer_at
          THEN 'replied_by_owner'
        WHEN COALESCE(r.follow_up_enabled, TRUE) = FALSE THEN 'follow_up_disabled'
        WHEN COALESCE(r.muted, FALSE) THEN 'chat_muted'
        WHEN COALESCE(r.ignored, FALSE) THEN 'chat_ignored'
        WHEN COALESCE(r.is_bot, FALSE) THEN 'is_bot'
        WHEN r.follow_up_acked_at IS NOT NULL
             AND r.follow_up_acked_at >= p.last_customer_at THEN 'acked'
        WHEN r.follow_up_last_ping_at IS NULL
             AND EXTRACT(EPOCH FROM (NOW() - p.last_customer_at)) / 3600.0
                 < COALESCE(r.follow_up_threshold_hours, 2)
          THEN 'below_threshold'
        WHEN r.follow_up_last_ping_at IS NULL THEN 'would_ping_first'
        WHEN r.follow_up_last_ping_kind = 'first'
             AND EXTRACT(EPOCH FROM (NOW() - r.follow_up_last_ping_at)) / 3600.0
                 < COALESCE(r.follow_up_escalate_hours, 12)
          THEN 'waiting_for_escalate'
        WHEN r.follow_up_last_ping_kind = 'first' THEN 'would_ping_escalate'
        ELSE 'already_pinged_escalate'
      END AS decided
    FROM per_chat p
    LEFT JOIN chat_rules r ON r.chat_id = p.chat_id
    ORDER BY p.last_customer_at DESC NULLS LAST
    LIMIT 300`;
  const out: FollowUpDebugRow[] = [];
  for (const r0 of rows as Array<Record<string, unknown>>) {
    out.push({
      chatId: Number(r0.chat_id),
      chatTitle: (r0.chat_title as string) ?? null,
      firstName: (r0.first_name as string) ?? null,
      lastName: (r0.last_name as string) ?? null,
      nickname: (r0.nickname as string) ?? null,
      lastCustomerMessageAt: (r0.last_customer_at as Date) ?? null,
      lastOwnerMessageAt: (r0.last_owner_at as Date) ?? null,
      hoursSinceCustomer:
        r0.hours_since_customer == null
          ? null
          : Number(r0.hours_since_customer),
      followUpEnabled: Boolean(r0.follow_up_enabled),
      thresholdHours: Number(r0.threshold_h),
      escalateHours: Number(r0.escalate_h),
      lastPingAt: (r0.follow_up_last_ping_at as Date) ?? null,
      lastPingKind: (r0.follow_up_last_ping_kind as string) ?? null,
      ackedAt: (r0.follow_up_acked_at as Date) ?? null,
      muted: Boolean(r0.muted),
      ignored: Boolean(r0.ignored),
      isBot: Boolean(r0.is_bot),
      decided: String(r0.decided),
    });
  }
  return out;
}

export async function setChatSummaryIntervalHours(args: {
  chatId: number;
  hours: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, summary_interval_hours)
    VALUES (${args.chatId}, 'group', ${args.hours})
    ON CONFLICT (chat_id) DO UPDATE SET
      summary_interval_hours = ${args.hours},
      updated_at = NOW()`;
}

export async function getChatSummaryIntervalHours(
  chatId: number,
): Promise<number | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT summary_interval_hours FROM chat_rules WHERE chat_id = ${chatId} LIMIT 1`;
  const r = rows[0] as { summary_interval_hours: number | null } | undefined;
  return r?.summary_interval_hours ?? null;
}

export async function markChatSummaryRun(chatId: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE chat_rules SET last_summary_run_at = NOW(), updated_at = NOW()
    WHERE chat_id = ${chatId}`;
}

// --- Note watchlist ---

export type NoteWatchItem = {
  id: number;
  concept: string;
  description: string | null;
  enabled: boolean;
  matchCount: number;
  lastMatchedAt: Date | null;
  emoji: string | null;
  priority: "low" | "normal" | "high";
  forwardToInbox: boolean;
  cooldownOverrideMinutes: number | null;
  // Domain the concept lives in — e.g. "music / singer / concert".
  // The scanner only fires when the message is clearly in this
  // context AND contains the concept / an alias. Null = no
  // context filter (match purely on string presence).
  context: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NoteWatchMatch = {
  id: number;
  itemId: number;
  chatId: number;
  chatTitle: string | null;
  messageLogId: number | null;
  sourceMessageId: number | null;
  senderName: string | null;
  quote: string;
  reason: string | null;
  forwardedTo: number | null;
  createdAt: Date;
};

function rowToNoteWatchItem(r: Record<string, unknown>): NoteWatchItem {
  const rawPri = (r.priority as string) ?? "normal";
  const priority: NoteWatchItem["priority"] =
    rawPri === "low" || rawPri === "high" ? rawPri : "normal";
  return {
    id: Number(r.id),
    concept: r.concept as string,
    description: (r.description as string) ?? null,
    enabled: Boolean(r.enabled),
    matchCount: Number(r.match_count ?? 0),
    lastMatchedAt: (r.last_matched_at as Date) ?? null,
    emoji: (r.emoji as string) ?? null,
    priority,
    forwardToInbox:
      r.forward_to_inbox == null ? true : Boolean(r.forward_to_inbox),
    cooldownOverrideMinutes:
      r.cooldown_override_minutes != null
        ? Number(r.cooldown_override_minutes)
        : null,
    context: (r.context as string) ?? null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

function rowToNoteWatchMatch(r: Record<string, unknown>): NoteWatchMatch {
  return {
    id: Number(r.id),
    itemId: Number(r.item_id),
    chatId: Number(r.chat_id),
    chatTitle: (r.chat_title as string) ?? null,
    messageLogId: r.message_log_id != null ? Number(r.message_log_id) : null,
    sourceMessageId:
      r.source_message_id != null ? Number(r.source_message_id) : null,
    senderName: (r.sender_name as string) ?? null,
    quote: r.quote as string,
    reason: (r.reason as string) ?? null,
    forwardedTo: r.forwarded_to != null ? Number(r.forwarded_to) : null,
    createdAt: r.created_at as Date,
  };
}

export async function listNoteWatchItems(args?: {
  enabledOnly?: boolean;
}): Promise<NoteWatchItem[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const enabledOnly = args?.enabledOnly ?? false;
  const rows = await sql()`
    SELECT id, concept, description, enabled, match_count, last_matched_at,
           emoji, priority, forward_to_inbox, cooldown_override_minutes,
           context, created_at, updated_at
    FROM note_watch_items
    WHERE (${enabledOnly}::boolean = FALSE OR enabled = TRUE)
    ORDER BY created_at DESC`;
  return (rows as Array<Record<string, unknown>>).map(rowToNoteWatchItem);
}

export async function getNoteWatchItem(
  id: number,
): Promise<NoteWatchItem | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, concept, description, enabled, match_count, last_matched_at,
           emoji, priority, forward_to_inbox, cooldown_override_minutes,
           context, created_at, updated_at
    FROM note_watch_items WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToNoteWatchItem(r) : null;
}

export async function createNoteWatchItem(args: {
  concept: string;
  description?: string | null;
  enabled?: boolean;
}): Promise<NoteWatchItem> {
  if (!hasDb()) throw new Error("DATABASE_URL not set");
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO note_watch_items (concept, description, enabled)
    VALUES (${args.concept}, ${args.description ?? null}, ${args.enabled ?? true})
    RETURNING id, concept, description, enabled, match_count, last_matched_at,
              emoji, priority, forward_to_inbox, cooldown_override_minutes,
              context, created_at, updated_at`;
  return rowToNoteWatchItem(rows[0] as Record<string, unknown>);
}

export async function updateNoteWatchItem(
  id: number,
  patch: Partial<{
    concept: string;
    description: string | null;
    enabled: boolean;
    emoji: string | null;
    priority: "low" | "normal" | "high";
    forwardToInbox: boolean;
    cooldownOverrideMinutes: number | null;
    context: string | null;
  }>,
): Promise<NoteWatchItem | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  // Use markers for nullable fields so we can tell "leave alone"
  // (undefined) from "set to NULL" (null).
  const descMarker = patch.description === undefined ? 0 : 1;
  const descValue = patch.description ?? null;
  const emojiMarker = patch.emoji === undefined ? 0 : 1;
  const emojiValue = patch.emoji ?? null;
  const cooldownMarker =
    patch.cooldownOverrideMinutes === undefined ? 0 : 1;
  const cooldownValue = patch.cooldownOverrideMinutes ?? null;
  const contextMarker = patch.context === undefined ? 0 : 1;
  const contextValue = patch.context ?? null;
  const rows = await sql()`
    UPDATE note_watch_items SET
      concept = COALESCE(${patch.concept ?? null}, concept),
      description = CASE WHEN ${descMarker}::int = 1 THEN ${descValue} ELSE description END,
      enabled = COALESCE(${patch.enabled ?? null}::boolean, enabled),
      emoji = CASE WHEN ${emojiMarker}::int = 1 THEN ${emojiValue} ELSE emoji END,
      priority = COALESCE(${patch.priority ?? null}, priority),
      forward_to_inbox = COALESCE(${patch.forwardToInbox ?? null}::boolean, forward_to_inbox),
      cooldown_override_minutes = CASE
        WHEN ${cooldownMarker}::int = 1 THEN ${cooldownValue}::int
        ELSE cooldown_override_minutes
      END,
      context = CASE WHEN ${contextMarker}::int = 1 THEN ${contextValue} ELSE context END,
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, concept, description, enabled, match_count, last_matched_at,
              emoji, priority, forward_to_inbox, cooldown_override_minutes,
              context, created_at, updated_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToNoteWatchItem(r) : null;
}

export async function deleteNoteWatchItem(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM note_watch_items WHERE id = ${id}`;
}

export type NoteWatchAlias = {
  id: number;
  itemId: number;
  alias: string;
  createdAt: Date;
};

export async function listNoteWatchAliases(
  itemId?: number,
): Promise<NoteWatchAlias[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = itemId
    ? await sql()`
        SELECT id, item_id, alias, created_at
        FROM note_watch_aliases
        WHERE item_id = ${itemId}
        ORDER BY created_at ASC`
    : await sql()`
        SELECT id, item_id, alias, created_at
        FROM note_watch_aliases
        ORDER BY item_id, created_at ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    itemId: Number(r.item_id),
    alias: r.alias as string,
    createdAt: r.created_at as Date,
  }));
}

export async function addNoteWatchAlias(args: {
  itemId: number;
  alias: string;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO note_watch_aliases (item_id, alias)
    VALUES (${args.itemId}, ${args.alias})
    ON CONFLICT (item_id, alias) DO NOTHING`;
}

export async function deleteNoteWatchAlias(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM note_watch_aliases WHERE id = ${id}`;
}

// One-shot fetch used by the bot scanner: every enabled concept with
// its alias list inlined. Keeps the scanner from issuing N+1 lookups
// per message.
export async function listNoteWatchItemsWithAliases(args?: {
  enabledOnly?: boolean;
}): Promise<Array<NoteWatchItem & { aliases: string[] }>> {
  if (!hasDb()) return [];
  await ensureSchema();
  const items = await listNoteWatchItems({
    enabledOnly: args?.enabledOnly ?? false,
  });
  if (items.length === 0) return [];
  const allAliases = await listNoteWatchAliases();
  const byItem = new Map<number, string[]>();
  for (const a of allAliases) {
    const arr = byItem.get(a.itemId) ?? [];
    arr.push(a.alias);
    byItem.set(a.itemId, arr);
  }
  return items.map((it) => ({ ...it, aliases: byItem.get(it.id) ?? [] }));
}

export async function recordNoteWatchMatch(args: {
  itemId: number;
  chatId: number;
  chatTitle: string | null;
  messageLogId: number | null;
  sourceMessageId: number | null;
  senderName: string | null;
  quote: string;
  reason: string | null;
  forwardedTo: number | null;
}): Promise<NoteWatchMatch | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO note_watch_matches (
      item_id, chat_id, chat_title, message_log_id, source_message_id,
      sender_name, quote, reason, forwarded_to
    ) VALUES (
      ${args.itemId}, ${args.chatId}, ${args.chatTitle},
      ${args.messageLogId}, ${args.sourceMessageId},
      ${args.senderName}, ${args.quote}, ${args.reason}, ${args.forwardedTo}
    )
    RETURNING id, item_id, chat_id, chat_title, message_log_id, source_message_id,
              sender_name, quote, reason, forwarded_to, created_at`;
  await sql()`
    UPDATE note_watch_items
    SET match_count = match_count + 1, last_matched_at = NOW()
    WHERE id = ${args.itemId}`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToNoteWatchMatch(r) : null;
}

// Cooldown gate: returns true when there's already a recent match
// for this (itemId, chatId) within the window — caller should skip
// the LLM call / forward to keep one chat from spamming the inbox.
export async function hasRecentNoteWatchMatch(args: {
  itemId: number;
  chatId: number;
  withinMinutes: number;
}): Promise<boolean> {
  if (!hasDb()) return false;
  await ensureSchema();
  if (args.withinMinutes <= 0) return false;
  const rows = await sql()`
    SELECT 1 FROM note_watch_matches
    WHERE item_id = ${args.itemId}
      AND chat_id = ${args.chatId}
      AND created_at > NOW() - make_interval(mins => ${args.withinMinutes})
    LIMIT 1`;
  return rows.length > 0;
}

// Archive sweeper used by the optional notesAutoArchiveDays setting.
// Marks every non-archived chat_notes row older than `days` as
// archived. Returns the number affected so the cron can log it.
export async function archiveOldChatNotes(days: number): Promise<number> {
  if (!hasDb() || days <= 0) return 0;
  await ensureSchema();
  const rows = await sql()`
    UPDATE chat_notes
    SET archived_at = NOW()
    WHERE archived_at IS NULL
      AND created_at < NOW() - make_interval(days => ${days})
    RETURNING id`;
  return rows.length;
}

export async function listNoteWatchMatches(args?: {
  itemId?: number;
  limit?: number;
  offset?: number;
}): Promise<NoteWatchMatch[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const limit = Math.min(Math.max(args?.limit ?? 50, 1), 200);
  const offset = Math.max(args?.offset ?? 0, 0);
  const rows = await sql()`
    SELECT id, item_id, chat_id, chat_title, message_log_id, source_message_id,
           sender_name, quote, reason, forwarded_to, created_at
    FROM note_watch_matches
    WHERE (${args?.itemId ?? null}::bigint IS NULL OR item_id = ${args?.itemId ?? null}::bigint)
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  return (rows as Array<Record<string, unknown>>).map(rowToNoteWatchMatch);
}

// --- Secretary relays ---

export type SecretaryRelay = {
  id: number;
  name: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SecretaryRelayParty = {
  relayId: number;
  chatId: number;
  label: string | null;
  createdAt: Date;
};

function rowToSecretaryRelay(r: Record<string, unknown>): SecretaryRelay {
  return {
    id: Number(r.id),
    name: r.name as string,
    enabled: Boolean(r.enabled),
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

export async function listSecretaryRelays(args?: {
  enabledOnly?: boolean;
}): Promise<SecretaryRelay[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const enabledOnly = args?.enabledOnly ?? false;
  const rows = await sql()`
    SELECT id, name, enabled, created_at, updated_at
    FROM secretary_relays
    WHERE (${enabledOnly}::boolean = FALSE OR enabled = TRUE)
    ORDER BY created_at DESC`;
  return (rows as Array<Record<string, unknown>>).map(rowToSecretaryRelay);
}

export async function getSecretaryRelay(id: number): Promise<SecretaryRelay | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, name, enabled, created_at, updated_at
    FROM secretary_relays WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToSecretaryRelay(r) : null;
}

export async function createSecretaryRelay(args: {
  name: string;
  enabled?: boolean;
}): Promise<SecretaryRelay> {
  if (!hasDb()) throw new Error("DATABASE_URL not set");
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO secretary_relays (name, enabled)
    VALUES (${args.name}, ${args.enabled ?? true})
    RETURNING id, name, enabled, created_at, updated_at`;
  return rowToSecretaryRelay(rows[0] as Record<string, unknown>);
}

export async function updateSecretaryRelay(
  id: number,
  patch: Partial<{ name: string; enabled: boolean }>,
): Promise<SecretaryRelay | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    UPDATE secretary_relays SET
      name = COALESCE(${patch.name ?? null}, name),
      enabled = COALESCE(${patch.enabled ?? null}::boolean, enabled),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, name, enabled, created_at, updated_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToSecretaryRelay(r) : null;
}

export async function deleteSecretaryRelay(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM secretary_relays WHERE id = ${id}`;
}

export async function listSecretaryRelaySources(
  relayId: number,
): Promise<SecretaryRelayParty[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT relay_id, source_chat_id, source_label, created_at
    FROM secretary_relay_sources
    WHERE relay_id = ${relayId}
    ORDER BY created_at ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    relayId: Number(r.relay_id),
    chatId: Number(r.source_chat_id),
    label: (r.source_label as string) ?? null,
    createdAt: r.created_at as Date,
  }));
}

export async function addSecretaryRelaySource(args: {
  relayId: number;
  sourceChatId: number;
  label?: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO secretary_relay_sources (relay_id, source_chat_id, source_label)
    VALUES (${args.relayId}, ${args.sourceChatId}, ${args.label ?? null})
    ON CONFLICT (relay_id, source_chat_id) DO UPDATE SET
      source_label = COALESCE(EXCLUDED.source_label, secretary_relay_sources.source_label)`;
}

export async function removeSecretaryRelaySource(args: {
  relayId: number;
  sourceChatId: number;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    DELETE FROM secretary_relay_sources
    WHERE relay_id = ${args.relayId}
      AND source_chat_id = ${args.sourceChatId}`;
}

export async function listSecretaryRelayRecipients(
  relayId: number,
): Promise<SecretaryRelayParty[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT relay_id, recipient_chat_id, recipient_label, created_at
    FROM secretary_relay_recipients
    WHERE relay_id = ${relayId}
    ORDER BY created_at ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    relayId: Number(r.relay_id),
    chatId: Number(r.recipient_chat_id),
    label: (r.recipient_label as string) ?? null,
    createdAt: r.created_at as Date,
  }));
}

export async function addSecretaryRelayRecipient(args: {
  relayId: number;
  recipientChatId: number;
  label?: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO secretary_relay_recipients (relay_id, recipient_chat_id, recipient_label)
    VALUES (${args.relayId}, ${args.recipientChatId}, ${args.label ?? null})
    ON CONFLICT (relay_id, recipient_chat_id) DO UPDATE SET
      recipient_label = COALESCE(EXCLUDED.recipient_label, secretary_relay_recipients.recipient_label)`;
}

export async function removeSecretaryRelayRecipient(args: {
  relayId: number;
  recipientChatId: number;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    DELETE FROM secretary_relay_recipients
    WHERE relay_id = ${args.relayId}
      AND recipient_chat_id = ${args.recipientChatId}`;
}

// Lookup: every enabled Route that lists this source chat.
export async function findEnabledRelaysForSource(
  sourceChatId: number,
): Promise<
  Array<SecretaryRelay & { recipients: SecretaryRelayParty[] }>
> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT r.id, r.name, r.enabled, r.created_at, r.updated_at
    FROM secretary_relays r
    JOIN secretary_relay_sources s ON s.relay_id = r.id
    WHERE r.enabled = TRUE
      AND s.source_chat_id = ${sourceChatId}
    ORDER BY r.created_at ASC`;
  const relays = (rows as Array<Record<string, unknown>>).map(
    rowToSecretaryRelay,
  );
  const out: Array<SecretaryRelay & { recipients: SecretaryRelayParty[] }> = [];
  for (const relay of relays) {
    const recipients = await listSecretaryRelayRecipients(relay.id);
    out.push({ ...relay, recipients });
  }
  return out;
}

export async function recordSecretaryRelayLink(args: {
  relayId: number | null;
  businessConnectionId: string | null;
  sourceChatId: number;
  sourceMessageId: number | null;
  recipientChatId: number;
  recipientMessageId: number;
  direction: "inbound" | "outbound";
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO secretary_relay_links (
      relay_id, business_connection_id, source_chat_id, source_message_id,
      recipient_chat_id, recipient_message_id, direction
    ) VALUES (
      ${args.relayId ?? null}, ${args.businessConnectionId},
      ${args.sourceChatId}, ${args.sourceMessageId ?? null},
      ${args.recipientChatId}, ${args.recipientMessageId}, ${args.direction}
    )
    ON CONFLICT (recipient_chat_id, recipient_message_id) DO UPDATE SET
      source_message_id = COALESCE(EXCLUDED.source_message_id,
                                   secretary_relay_links.source_message_id)`;
}

export type SecretaryRelayLink = {
  id: number;
  relayId: number | null;
  businessConnectionId: string | null;
  sourceChatId: number;
  sourceMessageId: number | null;
  recipientChatId: number;
  recipientMessageId: number;
  direction: string;
};

// Reply routing: given an inbound message at (recipient_chat,
// recipient_message_id) — typically the message the recipient is
// REPLYING to — find the source chat to relay the reply back to.
export async function findSecretaryRelayLinkByRecipientMessage(
  recipientChatId: number,
  recipientMessageId: number,
): Promise<SecretaryRelayLink | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, relay_id, business_connection_id, source_chat_id, source_message_id,
           recipient_chat_id, recipient_message_id, direction
    FROM secretary_relay_links
    WHERE recipient_chat_id = ${recipientChatId}
      AND recipient_message_id = ${recipientMessageId}
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    relayId: r.relay_id != null ? Number(r.relay_id) : null,
    businessConnectionId: (r.business_connection_id as string) ?? null,
    sourceChatId: Number(r.source_chat_id),
    sourceMessageId:
      r.source_message_id != null ? Number(r.source_message_id) : null,
    recipientChatId: Number(r.recipient_chat_id),
    recipientMessageId: Number(r.recipient_message_id),
    direction: r.direction as string,
  };
}

// Fallback when the recipient typed a fresh message (no reply): pick
// the most recent inbound link for this recipient chat. Lets a
// recipient "just type" in their DM without manually replying to the
// forwarded message.
export async function findLatestInboundLinkForRecipient(
  recipientChatId: number,
  withinMinutes: number,
): Promise<SecretaryRelayLink | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, relay_id, business_connection_id, source_chat_id, source_message_id,
           recipient_chat_id, recipient_message_id, direction
    FROM secretary_relay_links
    WHERE recipient_chat_id = ${recipientChatId}
      AND direction = 'inbound'
      AND created_at > NOW() - make_interval(mins => ${withinMinutes})
    ORDER BY created_at DESC LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    relayId: r.relay_id != null ? Number(r.relay_id) : null,
    businessConnectionId: (r.business_connection_id as string) ?? null,
    sourceChatId: Number(r.source_chat_id),
    sourceMessageId:
      r.source_message_id != null ? Number(r.source_message_id) : null,
    recipientChatId: Number(r.recipient_chat_id),
    recipientMessageId: Number(r.recipient_message_id),
    direction: r.direction as string,
  };
}

// Source-side reverse lookup: when the source message itself comes in
// (e.g. for a "delete" or "edit" propagation), find the recipient
// copies. Not used by the current implementation but exposed for
// future extension.
export async function listRelayLinksBySource(
  sourceChatId: number,
  sourceMessageId: number,
): Promise<SecretaryRelayLink[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, relay_id, business_connection_id, source_chat_id, source_message_id,
           recipient_chat_id, recipient_message_id, direction
    FROM secretary_relay_links
    WHERE source_chat_id = ${sourceChatId}
      AND source_message_id = ${sourceMessageId}`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    relayId: r.relay_id != null ? Number(r.relay_id) : null,
    businessConnectionId: (r.business_connection_id as string) ?? null,
    sourceChatId: Number(r.source_chat_id),
    sourceMessageId:
      r.source_message_id != null ? Number(r.source_message_id) : null,
    recipientChatId: Number(r.recipient_chat_id),
    recipientMessageId: Number(r.recipient_message_id),
    direction: r.direction as string,
  }));
}

export async function setChatPhoneNumber(
  chatId: number,
  phoneNumber: string | null,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const trimmed = phoneNumber?.trim() ?? null;
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title, phone_number, updated_at)
    VALUES (
      ${chatId},
      COALESCE(
        (SELECT MAX(chat_type) FROM messages_log WHERE chat_id = ${chatId}),
        CASE WHEN ${chatId}::bigint < 0 THEN 'supergroup' ELSE 'private' END
      ),
      (SELECT MAX(chat_title) FROM messages_log WHERE chat_id = ${chatId}),
      ${trimmed},
      NOW()
    )
    ON CONFLICT (chat_id) DO UPDATE SET
      phone_number = ${trimmed},
      updated_at = NOW()`;
}

export async function setChatIgnored(
  chatId: number,
  ignored: boolean,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  // Same upsert dance as setAutoSummarize so chats without a
  // chat_rules row yet still get one when the flag is toggled.
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title, ignored, updated_at)
    VALUES (
      ${chatId},
      COALESCE(
        (SELECT MAX(chat_type) FROM messages_log WHERE chat_id = ${chatId}),
        CASE WHEN ${chatId}::bigint < 0 THEN 'supergroup' ELSE 'private' END
      ),
      (SELECT MAX(chat_title) FROM messages_log WHERE chat_id = ${chatId}),
      ${ignored},
      NOW()
    )
    ON CONFLICT (chat_id) DO UPDATE SET
      ignored = ${ignored},
      updated_at = NOW()`;
}

// Lightweight "should we even touch this chat?" check used at the top
// of handleBusinessMessage / handleAnyChatPost so the rest of the
// pipeline never sees ignored chats. Cached in-memory briefly so a
// burst of messages doesn't query for every one.
const ignoredCache = new Map<number, { v: boolean; expiresAt: number }>();
const IGNORED_TTL_MS = 10_000;

export async function isChatIgnored(chatId: number): Promise<boolean> {
  if (!hasDb()) return false;
  const cached = ignoredCache.get(chatId);
  if (cached && cached.expiresAt > Date.now()) return cached.v;
  await ensureSchema();
  const rows = await sql()`
    SELECT ignored FROM chat_rules WHERE chat_id = ${chatId} LIMIT 1`;
  const v = Boolean((rows[0] as { ignored?: boolean } | undefined)?.ignored);
  ignoredCache.set(chatId, { v, expiresAt: Date.now() + IGNORED_TTL_MS });
  return v;
}

export function invalidateIgnoredCache(chatId?: number): void {
  if (chatId == null) ignoredCache.clear();
  else ignoredCache.delete(chatId);
}

// First chat tagged as the summary_inbox. The caller decides whether
// to fan out to multiple if more than one is tagged; for now we use
// the most recently updated one.
export async function getPrimarySummaryInbox(): Promise<ChatRule | null> {
  if (!hasDb()) return null;
  const list = await listChatsByFunction("summary_inbox");
  return list[0] ?? null;
}

export async function listChatsByFunction(
  role: FunctionRole,
  tenantId?: number | null,
): Promise<ChatRule[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  // Pull chats whose junction table OR legacy function_role column
  // contains this role. The OR keeps the path safe even if the
  // migration hasn't run yet on a stale deploy.
  const rows = await sql()`
    SELECT r.chat_id, r.chat_type, r.chat_title, r.vip, r.muted, r.custom_reply, r.notes,
           r.mode, r.mode_changed_at, r.secretary_user_id,
           r.first_name, r.last_name, r.nickname, r.relationship,
           r.relationship_notes, r.talk_style_notes,
           r.tone_profile, r.tone_profile_at,
           r.flood_cooldown_until, r.flood_deflected_at,
           r.ai_process_voice, r.ai_process_stickers, r.ai_process_gifs, r.ai_process_photos,
           r.ai_process_video_notes, r.ai_generate_photo,
           r.function_role, r.function_config,
           r.auto_summarize_enabled, r.auto_summarize_gap_minutes,
           r.auto_summarize_smart_timing,
           r.last_auto_summary_at,
           r.auto_forward_voice, r.auto_forward_video, r.auto_forward_photo,
           r.auto_forward_location, r.auto_extract_notes,
           r.is_bot, r.ignored, r.phone_number,
           r.grace_skipped_at, r.updated_at
    FROM chat_rules r
    WHERE (
      r.function_role = ${role}
      OR EXISTS (
        SELECT 1 FROM chat_function_roles f
        WHERE f.chat_id = r.chat_id AND f.role = ${role}
      )
    )
      AND (${tenantId ?? null}::bigint IS NULL OR r.tenant_id = ${tenantId ?? null})
    ORDER BY r.updated_at DESC`;
  return (rows as Array<Record<string, unknown>>).map(rowToChatRule);
}

// All function roles for a single chat, sorted alphabetically. New
// code should read from here; the legacy ChatRule.functionRole single
// value stays exposed for backwards compat with callers that haven't
// been migrated to multi-role yet.
export async function getChatFunctionRoles(
  chatId: number,
): Promise<FunctionRole[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT role FROM chat_function_roles
    WHERE chat_id = ${chatId}
    ORDER BY role ASC`;
  return (rows as Array<{ role: string }>)
    .map((r) => r.role)
    .filter((r): r is FunctionRole =>
      (FUNCTION_ROLES as readonly string[]).includes(r),
    );
}

export async function setChatFunctionRoles(
  chatId: number,
  roles: FunctionRole[],
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const q = sql();
  // Replace strategy — clear then insert. Roles list is small (≤10
  // total) so the round-trip cost is negligible.
  await q`DELETE FROM chat_function_roles WHERE chat_id = ${chatId}`;
  const filtered = roles.filter((r) =>
    (FUNCTION_ROLES as readonly string[]).includes(r),
  );
  for (const role of filtered) {
    await q`
      INSERT INTO chat_function_roles (chat_id, role)
      VALUES (${chatId}, ${role})
      ON CONFLICT (chat_id, role) DO NOTHING`;
  }
  // Mirror to the legacy single-role column for callers still on
  // the old API: pick the first role (sorted by insertion order).
  // chat_rules row must exist; create if not. Same chat_type lookup
  // dance as setChatAutomation so we don't stamp 'private' onto a
  // channel that's never had a chat_rules row before.
  const primary = filtered[0] ?? null;
  const guessed = chatId < 0 ? "supergroup" : "private";
  await q`
    INSERT INTO chat_rules (chat_id, chat_type, function_role, updated_at)
    VALUES (${chatId},
      COALESCE(
        (SELECT chat_type FROM messages_log WHERE chat_id = ${chatId} LIMIT 1),
        ${guessed}
      ),
      ${primary}, NOW())
    ON CONFLICT (chat_id) DO UPDATE SET
      function_role = ${primary},
      updated_at = NOW()`;
}

// Persist a fine-tuned tone profile for a chat. Separate from
// upsertChatRule so we can update it without overwriting any of the
// per-chat metadata.
export async function saveToneProfile(
  chatId: number,
  toneProfile: string,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE chat_rules
    SET tone_profile = ${toneProfile},
        tone_profile_at = NOW(),
        updated_at = NOW()
    WHERE chat_id = ${chatId}`;
}

// Cooldown helpers for the flood-protection / waitlist logic. Once we
// send the "I'm busy" deflection, we stay silent in that chat for the
// duration of the cooldown.
export async function setFloodCooldown(
  chatId: number,
  cooldownUntil: Date,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE chat_rules
    SET flood_cooldown_until = ${cooldownUntil.toISOString()},
        flood_deflected_at = NOW(),
        updated_at = NOW()
    WHERE chat_id = ${chatId}`;
}

// Count how many non-owner, non-bot messages this chat received in the
// last N seconds. Used by the AI reply path to decide whether the
// person is flooding.
export async function recentIncomingCount(
  chatId: number,
  windowSeconds: number,
): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const rows = await sql()`
    SELECT COUNT(*)::int AS n FROM messages_log
    WHERE chat_id = ${chatId}
      AND from_owner = FALSE
      AND source IS NULL
      AND created_at > NOW() - (${windowSeconds} || ' seconds')::INTERVAL`;
  return Number((rows[0] as { n: number })?.n) || 0;
}

// Owner clicked "Resume bot now" — mark grace as skipped at this instant.
// The bot's grace check ignores grace whenever grace_skipped_at is more
// recent than the owner's last message in this chat. As soon as the owner
// sends another message, grace_skipped_at becomes older than that and the
// grace timer restarts automatically.
export async function skipChatGrace(args: {
  chatId: number;
  chatType: string;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, grace_skipped_at, updated_at)
    VALUES (${args.chatId}, ${args.chatType}, NOW(), NOW())
    ON CONFLICT (chat_id) DO UPDATE SET
      grace_skipped_at = NOW(),
      updated_at = NOW()`;
}

// Auto-fill chat first/last name from Telegram's user info ONLY when the
// owner hasn't set them yet (COALESCE keeps existing custom values).
export async function autoFillChatNames(args: {
  chatId: number;
  chatType: string;
  firstName?: string | null;
  lastName?: string | null;
  isBot?: boolean;
}): Promise<void> {
  if (!hasDb()) return;
  if (!args.firstName && !args.lastName && !args.isBot) return;
  await ensureSchema();
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, first_name, last_name, is_bot, updated_at)
    VALUES (${args.chatId}, ${args.chatType},
            ${args.firstName ?? null}, ${args.lastName ?? null},
            ${args.isBot ?? false}, NOW())
    ON CONFLICT (chat_id) DO UPDATE SET
      first_name = COALESCE(chat_rules.first_name, EXCLUDED.first_name),
      last_name = COALESCE(chat_rules.last_name, EXCLUDED.last_name),
      is_bot = chat_rules.is_bot OR EXCLUDED.is_bot,
      updated_at = CASE
        WHEN chat_rules.first_name IS NULL OR chat_rules.last_name IS NULL
          THEN NOW() ELSE chat_rules.updated_at
      END`;
}

export async function getChatMode(
  chatId: number,
): Promise<{ mode: ChatMode; changedAt: Date }> {
  const rule = await getChatRule(chatId).catch(() => null);
  return {
    mode: rule?.mode ?? "off",
    changedAt: rule?.modeChangedAt ?? new Date(0),
  };
}

export async function listChats(opts: {
  limit?: number;
  offset?: number;
} = {}): Promise<
  Array<{
    chatId: number;
    chatType: string;
    chatTitle: string | null;
    messages: number;
    urgent: number;
    lastSeen: Date | null;
    vip: boolean;
    muted: boolean;
    customReply: string | null;
    mode: ChatMode;
    modeChangedAt: Date | null;
    firstName: string | null;
    lastName: string | null;
    nickname: string | null;
    relationship: Relationship | null;
    secretaryUserId: number | null;
    functionRole: string | null;
    isBot: boolean;
    aiCostUsd: number;
    aiTokens: number;
  }>
> {
  await ensureSchema();
  const rows = await sql()`
    SELECT
      m.chat_id,
      MAX(m.chat_type) AS chat_type,
      MAX(m.chat_title) AS chat_title,
      COUNT(*)::int AS messages,
      COUNT(*) FILTER (WHERE m.urgent)::int AS urgent,
      MAX(m.created_at) AS last_seen,
      BOOL_OR(COALESCE(r.vip, FALSE)) AS vip,
      BOOL_OR(COALESCE(r.muted, FALSE)) AS muted,
      MAX(r.custom_reply) AS custom_reply,
      MAX(r.mode) AS mode,
      MAX(r.mode_changed_at) AS mode_changed_at,
      MAX(r.first_name) AS first_name,
      MAX(r.last_name) AS last_name,
      MAX(r.nickname) AS nickname,
      MAX(r.relationship) AS relationship,
      MAX(r.secretary_user_id) AS secretary_user_id,
      MAX(r.function_role) AS function_role,
      BOOL_OR(COALESCE(r.is_bot, FALSE)) AS is_bot,
      COALESCE(SUM(u.cost_usd), 0)::float8 AS ai_cost,
      COALESCE(SUM(u.total_tokens), 0)::int AS ai_tokens
    FROM messages_log m
    LEFT JOIN chat_rules r ON r.chat_id = m.chat_id
    LEFT JOIN ai_usage  u ON u.chat_id = m.chat_id
    GROUP BY m.chat_id
    ORDER BY last_seen DESC NULLS LAST
    LIMIT ${Math.min(Math.max(opts.limit ?? 200, 1), 500)}
    OFFSET ${Math.max(opts.offset ?? 0, 0)}`;
  return rows.map((r) => {
    const mode = (r.mode as string) ?? "off";
    const rel = (r.relationship as string) ?? null;
    return {
      chatId: Number(r.chat_id),
      chatType: r.chat_type as string,
      chatTitle: (r.chat_title as string) ?? null,
      messages: Number(r.messages),
      urgent: Number(r.urgent),
      lastSeen: (r.last_seen as Date) ?? null,
      vip: r.vip as boolean,
      muted: r.muted as boolean,
      customReply: (r.custom_reply as string) ?? null,
      mode: (CHAT_MODES.includes(mode as ChatMode) ? mode : "off") as ChatMode,
      modeChangedAt: (r.mode_changed_at as Date) ?? null,
      firstName: (r.first_name as string) ?? null,
      lastName: (r.last_name as string) ?? null,
      nickname: (r.nickname as string) ?? null,
      relationship:
        rel && (RELATIONSHIPS as readonly string[]).includes(rel)
          ? (rel as Relationship)
          : null,
      secretaryUserId:
        r.secretary_user_id == null ? null : Number(r.secretary_user_id),
      functionRole: (r.function_role as string) ?? null,
      isBot: Boolean(r.is_bot),
      aiCostUsd: Number(r.ai_cost) || 0,
      aiTokens: Number(r.ai_tokens) || 0,
    };
  });
}

// --- AI usage tracking ---

export type AiUsage = {
  chatId?: number | null;
  businessConnectionId?: string | null;
  model: string;
  purpose: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};

export async function recordAiUsage(u: AiUsage): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  // Pull tenant from AsyncLocalStorage when set. Avoids requiring
  // every caller to thread tenantId — the budget gate at the call
  // site relies on this row being attributed correctly.
  const { getCurrentTenantId } = await import("./tenant-context");
  const tenantId = getCurrentTenantId();
  await sql()`
    INSERT INTO ai_usage (
      chat_id, business_connection_id, model, purpose,
      prompt_tokens, completion_tokens, total_tokens, cost_usd, tenant_id
    ) VALUES (
      ${u.chatId ?? null}, ${u.businessConnectionId ?? null}, ${u.model}, ${u.purpose},
      ${u.promptTokens}, ${u.completionTokens}, ${u.totalTokens}, ${u.costUsd},
      ${tenantId ?? null}
    )`;
  // Keep the openrouter budget cache in sync so a flurry of calls in
  // the same instance sees the new spend without waiting for the 10s
  // TTL. Imported lazily to avoid a circular require.
  if (tenantId != null && u.costUsd > 0) {
    const { bumpOpenrouterSpent } = await import("./openrouter-budget");
    bumpOpenrouterSpent(tenantId, u.costUsd);
  }
}

// --- Owner-uploaded binary assets ---

export type OwnerAsset = { mime: string; data: Uint8Array; updatedAt: Date };

export async function setOwnerAsset(args: {
  kind: string;
  mime: string;
  data: Uint8Array;
  tenantId?: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const tenantId = args.tenantId ?? null;
  // Delete-then-insert because the unique index uses COALESCE on
  // tenant_id and ON CONFLICT can't target an expression index in
  // every Postgres version. Race is harmless — worst case the latest
  // upload wins.
  await sql()`
    DELETE FROM owner_assets
    WHERE kind = ${args.kind}
      AND COALESCE(tenant_id, 0) = COALESCE(${tenantId}, 0)`;
  await sql()`
    INSERT INTO owner_assets (kind, tenant_id, mime, data, updated_at)
    VALUES (${args.kind}, ${tenantId}, ${args.mime}, ${args.data}, NOW())`;
}

export async function getOwnerAsset(
  kind: string,
  tenantId?: number | null,
): Promise<OwnerAsset | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT mime, data, updated_at
    FROM owner_assets
    WHERE kind = ${kind}
      AND COALESCE(tenant_id, 0) = COALESCE(${tenantId ?? null}, 0)
    LIMIT 1`;
  const r = rows[0] as
    | { mime: string; data: Uint8Array; updated_at: Date }
    | undefined;
  if (!r) return null;
  // neon driver returns BYTEA as a Buffer; normalise to Uint8Array.
  const data =
    r.data instanceof Uint8Array
      ? r.data
      : new Uint8Array(r.data as ArrayBufferLike);
  return { mime: r.mime, data, updatedAt: r.updated_at };
}

export async function deleteOwnerAsset(
  kind: string,
  tenantId?: number | null,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    DELETE FROM owner_assets
    WHERE kind = ${kind}
      AND COALESCE(tenant_id, 0) = COALESCE(${tenantId ?? null}, 0)`;
}

export async function aiUsageOverview(): Promise<{
  totalCostUsd: number;
  totalTokens: number;
  totalCalls: number;
  last24hCostUsd: number;
}> {
  if (!hasDb()) {
    return { totalCostUsd: 0, totalTokens: 0, totalCalls: 0, last24hCostUsd: 0 };
  }
  await ensureSchema();
  const rows = await sql()`
    SELECT
      COALESCE(SUM(cost_usd), 0)::float8 AS total_cost,
      COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
      COUNT(*)::int AS total_calls,
      COALESCE(SUM(cost_usd) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'), 0)::float8 AS cost_24h
    FROM ai_usage`;
  const r = rows[0] as {
    total_cost: number;
    total_tokens: number;
    total_calls: number;
    cost_24h: number;
  };
  return {
    totalCostUsd: Number(r.total_cost) || 0,
    totalTokens: Number(r.total_tokens) || 0,
    totalCalls: Number(r.total_calls) || 0,
    last24hCostUsd: Number(r.cost_24h) || 0,
  };
}

// --- Sender-side reaction lookup (inverse direction) ---

export async function findSecretaryLinkForSenderMessage(
  businessConnectionId: string,
  senderChatId: number,
  senderMessageId: number,
): Promise<{
  session: SecretarySession;
  secretaryMessageId: number;
} | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT s.*, l.secretary_message_id AS link_msg
    FROM secretary_sessions s
    JOIN secretary_message_links l ON l.session_id = s.id
    WHERE s.business_connection_id = ${businessConnectionId}
      AND s.sender_chat_id = ${senderChatId}
      AND l.sender_message_id = ${senderMessageId}
    ORDER BY l.created_at DESC LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    session: rowToSecretarySession(r),
    secretaryMessageId: Number(r.link_msg),
  };
}

// --- Recent conversation snapshot (for AI auto-reply) ---

export async function recentConversation(
  chatId: number,
  limit = 30,
): Promise<Array<{ from: "owner" | "other"; senderName: string; text: string; at: Date }>> {
  if (!hasDb()) return [];
  await ensureSchema();
  // For voice / sticker / GIF messages the message_text column is the
  // raw `[voice]` placeholder. If we have a transcript or a media
  // description for that row we surface THAT to the AI so future
  // replies are based on the real content. This is what makes the
  // transcript "stick" — once transcribed, every subsequent AI call
  // sees the words, not the placeholder.
  const rows = await sql()`
    SELECT created_at, from_owner, sender_name, message_text,
           transcript, media_description, media_kind
    FROM messages_log
    WHERE chat_id = ${chatId}
      AND (skipped_reason IS NULL OR skipped_reason <> 'muted')
    ORDER BY created_at DESC LIMIT ${limit}`;
  const r = rows as Array<{
    created_at: Date;
    from_owner: boolean;
    sender_name: string;
    message_text: string;
    transcript: string | null;
    media_description: string | null;
    media_kind: string | null;
  }>;
  return r
    .map((row) => {
      let text = row.message_text;
      if (row.transcript) text = row.transcript;
      else if (row.media_description) {
        text = `[${row.media_kind ?? "media"}] ${row.media_description}`;
      }
      return {
        from: row.from_owner ? ("owner" as const) : ("other" as const),
        senderName: row.sender_name,
        text,
        at: row.created_at,
      };
    })
    .reverse();
}

// Owner-typed messages only — strictly things the owner physically
// typed into Telegram, with NO bot-generated rows included. Used by
// the per-chat fine-tune button: feeding AI-generated replies back
// into the tone extractor would slowly poison the profile and the
// owner's "voice" would drift into whatever the model made up. The
// guard is `source IS NULL`: every bot send-path
// (ai_chat / friendly_reply / auto_reply / bot_echo / ai_dashboard /
// owner_dashboard) writes a non-null source, while messages actually
// typed by the owner from the Telegram client come in via the
// business_message echo with source IS NULL.
export async function ownerTypedMessages(
  chatId: number,
  limit = 300,
): Promise<string[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const cap = Math.min(Math.max(limit, 1), 1000);
  const rows = await sql()`
    SELECT message_text FROM messages_log
    WHERE chat_id = ${chatId}
      AND from_owner = TRUE
      AND source IS NULL
      AND message_text IS NOT NULL
      AND message_text <> ''
    ORDER BY created_at DESC
    LIMIT ${cap}`;
  return (rows as Array<{ message_text: string }>)
    .map((r) => r.message_text)
    .reverse();
}

// --- Settings ---

export async function getAllSettings(): Promise<Record<string, string>> {
  if (!hasDb()) return {};
  await ensureSchema();
  const rows = await sql()`SELECT key, value FROM settings`;
  const out: Record<string, string> = {};
  for (const r of rows) out[(r as { key: string }).key] = (r as { value: string }).value;
  return out;
}

export async function setSetting(
  key: string,
  value: string,
  actorId?: number,
): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO settings (key, value, updated_by, updated_at)
    VALUES (${key}, ${value}, ${actorId ?? null}, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()`;
}

// Per-tenant setting overrides. Read by lib/settings.ts when a tenant
// context is in scope. Empty value clears the override (falls back to
// global).
export async function getTenantSettings(
  tenantId: number,
): Promise<Record<string, string>> {
  if (!hasDb()) return {};
  await ensureSchema();
  const rows = await sql()`
    SELECT key, value FROM tenant_settings WHERE tenant_id = ${tenantId}`;
  const out: Record<string, string> = {};
  for (const r of rows) {
    out[(r as { key: string }).key] = (r as { value: string }).value;
  }
  return out;
}

export async function setTenantSetting(
  tenantId: number,
  key: string,
  value: string,
  actorId?: number,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  if (value === "") {
    await sql()`
      DELETE FROM tenant_settings
      WHERE tenant_id = ${tenantId} AND key = ${key}`;
    return;
  }
  await sql()`
    INSERT INTO tenant_settings (tenant_id, key, value, updated_by, updated_at)
    VALUES (${tenantId}, ${key}, ${value}, ${actorId ?? null}, NOW())
    ON CONFLICT (tenant_id, key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()`;
}

// --- Group summaries ---

export type GroupSummaryRow = {
  id: number;
  chatId: number;
  chatTitle: string | null;
  periodStart: Date;
  periodEnd: Date;
  messageCount: number;
  activeSenders: number;
  summary: string;
  topics: string[];
  actionItems: string[];
  mentionsOwner: boolean;
  createdAt: Date;
};

export async function listGroupSummaries(
  chatId?: number,
  limit = 30,
): Promise<GroupSummaryRow[]> {
  await ensureSchema();
  const q = sql();
  const rows = chatId
    ? await q`SELECT * FROM group_summaries WHERE chat_id = ${chatId} ORDER BY period_start DESC LIMIT ${limit}`
    : await q`SELECT * FROM group_summaries ORDER BY period_start DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: Number(r.id),
    chatId: Number(r.chat_id),
    chatTitle: (r.chat_title as string) ?? null,
    periodStart: r.period_start as Date,
    periodEnd: r.period_end as Date,
    messageCount: Number(r.message_count),
    activeSenders: Number(r.active_senders),
    summary: r.summary as string,
    topics: (r.topics as string[]) ?? [],
    actionItems: (r.action_items as string[]) ?? [],
    mentionsOwner: r.mentions_owner as boolean,
    createdAt: r.created_at as Date,
  }));
}

export async function upsertGroupSummary(s: {
  chatId: number;
  chatTitle: string | null;
  businessConnectionId: string | null;
  periodStart: Date;
  periodEnd: Date;
  messageCount: number;
  activeSenders: number;
  summary: string;
  topics: string[];
  actionItems: string[];
  mentionsOwner: boolean;
}): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO group_summaries (
      chat_id, chat_title, business_connection_id, period_start, period_end,
      message_count, active_senders, summary, topics, action_items, mentions_owner
    ) VALUES (
      ${s.chatId}, ${s.chatTitle}, ${s.businessConnectionId},
      ${s.periodStart.toISOString()}, ${s.periodEnd.toISOString()},
      ${s.messageCount}, ${s.activeSenders}, ${s.summary},
      ${JSON.stringify(s.topics)}::jsonb, ${JSON.stringify(s.actionItems)}::jsonb,
      ${s.mentionsOwner}
    )
    ON CONFLICT (chat_id, period_start) DO UPDATE SET
      message_count = EXCLUDED.message_count,
      active_senders = EXCLUDED.active_senders,
      summary = EXCLUDED.summary,
      topics = EXCLUDED.topics,
      action_items = EXCLUDED.action_items,
      mentions_owner = EXCLUDED.mentions_owner,
      created_at = NOW()`;
}

// Flat per-chat message dump for AI analytics. Returns messages from a
// single chat over a time window, oldest first, so the model sees the
// natural conversation flow when classifying announce/in-progress/done
// task lifecycles on /groups/[id].
export async function listChatMessagesForAnalysis(args: {
  chatId: number;
  since: Date;
  limit?: number;
}): Promise<{
  chatTitle: string | null;
  messages: {
    sender: string;
    text: string;
    at: Date;
    fromOwner: boolean;
    messageThreadId: number | null;
  }[];
}> {
  await ensureSchema();
  const limit = Math.min(Math.max(args.limit ?? 1500, 1), 5000);
  const rows = await sql()`
    SELECT chat_title, sender_name, message_text, transcript,
           media_description, media_kind, created_at, from_owner,
           message_thread_id
    FROM messages_log
    WHERE chat_id = ${args.chatId}
      AND created_at >= ${args.since.toISOString()}
      AND COALESCE(skipped_reason, '') <> 'muted'
    ORDER BY created_at ASC
    LIMIT ${limit}`;
  let chatTitle: string | null = null;
  const messages: {
    sender: string;
    text: string;
    at: Date;
    fromOwner: boolean;
    messageThreadId: number | null;
  }[] = [];
  for (const r of rows) {
    if (!chatTitle && r.chat_title) chatTitle = r.chat_title as string;
    const transcript = (r.transcript as string) ?? null;
    const desc = (r.media_description as string) ?? null;
    const kind = (r.media_kind as string) ?? null;
    const body = (r.message_text as string) ?? "";
    let text = body;
    if (!text && transcript) text = `[voice] ${transcript}`;
    else if (!text && desc) text = `[${kind ?? "media"}] ${desc}`;
    else if (!text && kind) text = `[${kind}]`;
    if (!text) continue;
    messages.push({
      sender: (r.sender_name as string) ?? "?",
      text,
      at: r.created_at as Date,
      fromOwner: Boolean(r.from_owner),
      messageThreadId:
        r.message_thread_id != null ? Number(r.message_thread_id) : null,
    });
  }
  return { chatTitle, messages };
}

export async function groupActivityForPeriod(args: {
  start: Date;
  end: Date;
}): Promise<
  Array<{
    chatId: number;
    chatType: string;
    chatTitle: string | null;
    businessConnectionId: string | null;
    messages: { sender: string; text: string; at: Date }[];
  }>
> {
  await ensureSchema();
  const rows = await sql()`
    SELECT chat_id, chat_type, chat_title, business_connection_id,
           sender_name, message_text, created_at
    FROM messages_log
    WHERE chat_type IN ('group', 'supergroup')
      AND created_at >= ${args.start.toISOString()}
      AND created_at <  ${args.end.toISOString()}
    ORDER BY chat_id, created_at`;
  const byChat = new Map<
    number,
    {
      chatId: number;
      chatType: string;
      chatTitle: string | null;
      businessConnectionId: string | null;
      messages: { sender: string; text: string; at: Date }[];
    }
  >();
  for (const r of rows) {
    const chatId = Number(r.chat_id);
    let bucket = byChat.get(chatId);
    if (!bucket) {
      bucket = {
        chatId,
        chatType: r.chat_type as string,
        chatTitle: (r.chat_title as string) ?? null,
        businessConnectionId: (r.business_connection_id as string) ?? null,
        messages: [],
      };
      byChat.set(chatId, bucket);
    }
    bucket.messages.push({
      sender: r.sender_name as string,
      text: r.message_text as string,
      at: r.created_at as Date,
    });
  }
  return [...byChat.values()];
}

// --- Audit ---

export async function audit(args: {
  actorId: number | null;
  actorName?: string | null;
  action: string;
  target?: string | null;
  details?: unknown;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO audit_log (actor_id, actor_name, action, target, details)
    VALUES (${args.actorId ?? null}, ${args.actorName ?? null}, ${args.action},
            ${args.target ?? null}, ${JSON.stringify(args.details ?? null)}::jsonb)`;
}

// --- Secretary relay ---

export type SecretarySession = {
  id: number;
  businessConnectionId: string;
  senderChatId: number;
  senderName: string | null;
  senderUsername: string | null;
  secretaryUserId: number;
  secretaryChatId: number;
  headerMessageId: number;
  ownerUserId: number | null;
  createdAt: Date;
  lastActivityAt: Date;
  endedAt: Date | null;
  endReason: string | null;
};

function rowToSecretarySession(r: Record<string, unknown>): SecretarySession {
  return {
    id: Number(r.id),
    businessConnectionId: r.business_connection_id as string,
    senderChatId: Number(r.sender_chat_id),
    senderName: (r.sender_name as string) ?? null,
    senderUsername: (r.sender_username as string) ?? null,
    secretaryUserId: Number(r.secretary_user_id),
    secretaryChatId: Number(r.secretary_chat_id),
    headerMessageId: Number(r.header_message_id),
    ownerUserId: r.owner_user_id != null ? Number(r.owner_user_id) : null,
    createdAt: r.created_at as Date,
    lastActivityAt: r.last_activity_at as Date,
    endedAt: (r.ended_at as Date) ?? null,
    endReason: (r.end_reason as string) ?? null,
  };
}

export async function findActiveSecretarySessionForSender(args: {
  bcId: string;
  senderChatId: number;
  idleMinutes: number;
}): Promise<SecretarySession | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT * FROM secretary_sessions
    WHERE business_connection_id = ${args.bcId}
      AND sender_chat_id = ${args.senderChatId}
      AND ended_at IS NULL
      AND last_activity_at > NOW() - make_interval(mins => ${args.idleMinutes})
    ORDER BY last_activity_at DESC LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToSecretarySession(r) : null;
}

export async function openSecretarySession(args: {
  businessConnectionId: string;
  senderChatId: number;
  senderName: string | null;
  senderUsername: string | null;
  secretaryUserId: number;
  secretaryChatId: number;
  headerMessageId: number;
  ownerUserId: number | null;
}): Promise<SecretarySession> {
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO secretary_sessions (
      business_connection_id, sender_chat_id, sender_name, sender_username,
      secretary_user_id, secretary_chat_id, header_message_id, owner_user_id
    ) VALUES (
      ${args.businessConnectionId}, ${args.senderChatId}, ${args.senderName}, ${args.senderUsername},
      ${args.secretaryUserId}, ${args.secretaryChatId}, ${args.headerMessageId}, ${args.ownerUserId}
    ) RETURNING *`;
  return rowToSecretarySession(rows[0] as Record<string, unknown>);
}

export async function touchSecretarySession(id: number): Promise<void> {
  if (!hasDb()) return;
  await sql()`UPDATE secretary_sessions SET last_activity_at = NOW() WHERE id = ${id}`;
}

export async function endSecretarySession(id: number, reason: string): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE secretary_sessions
    SET ended_at = NOW(), end_reason = ${reason}
    WHERE id = ${id} AND ended_at IS NULL`;
}

export async function recordSecretaryLink(args: {
  sessionId: number;
  secretaryChatId: number;
  secretaryMessageId: number;
  direction: "inbound" | "outbound";
  senderMessageId?: number | null;
}): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO secretary_message_links (
      session_id, secretary_chat_id, secretary_message_id, direction, sender_message_id
    ) VALUES (
      ${args.sessionId}, ${args.secretaryChatId}, ${args.secretaryMessageId},
      ${args.direction}, ${args.senderMessageId ?? null}
    )
    ON CONFLICT (secretary_chat_id, secretary_message_id) DO UPDATE
      SET sender_message_id = COALESCE(EXCLUDED.sender_message_id,
                                       secretary_message_links.sender_message_id)`;
}

export async function findLinkWithSenderMessage(
  secretaryChatId: number,
  secretaryMessageId: number,
): Promise<
  | (SecretarySession & { senderMessageIdLinked: number | null })
  | null
> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT s.*, l.sender_message_id AS linked_sender_message_id
    FROM secretary_sessions s
    JOIN secretary_message_links l ON l.session_id = s.id
    WHERE l.secretary_chat_id = ${secretaryChatId}
      AND l.secretary_message_id = ${secretaryMessageId}
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  const session = rowToSecretarySession(r);
  const linked = r.linked_sender_message_id;
  return {
    ...session,
    senderMessageIdLinked:
      linked != null ? Number(linked as string | number) : null,
  };
}

export async function findSessionByLinkedMessage(
  secretaryChatId: number,
  secretaryMessageId: number,
): Promise<SecretarySession | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT s.* FROM secretary_sessions s
    JOIN secretary_message_links l ON l.session_id = s.id
    WHERE l.secretary_chat_id = ${secretaryChatId}
      AND l.secretary_message_id = ${secretaryMessageId}
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToSecretarySession(r) : null;
}

export async function findOnlyActiveSessionForSecretary(
  secretaryUserId: number,
  idleMinutes: number,
): Promise<SecretarySession | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  // Return the most recent active session for this secretary. When several
  // are open simultaneously we assume the secretary means the one they
  // touched last — they can always tap "reply" on a specific thread to be
  // explicit.
  const rows = await sql()`
    SELECT * FROM secretary_sessions
    WHERE secretary_user_id = ${secretaryUserId}
      AND ended_at IS NULL
      AND last_activity_at > NOW() - make_interval(mins => ${idleMinutes})
    ORDER BY last_activity_at DESC LIMIT 1`;
  if (rows.length === 0) return null;
  return rowToSecretarySession(rows[0] as Record<string, unknown>);
}

export async function getSenderStats(chatId: number): Promise<{
  priorCount: number;
  urgentCount: number;
  lastSeen: Date | null;
  firstSeen: Date | null;
}> {
  if (!hasDb()) {
    return { priorCount: 0, urgentCount: 0, lastSeen: null, firstSeen: null };
  }
  await ensureSchema();
  const rows = await sql()`
    SELECT
      COUNT(*) FILTER (WHERE from_owner = FALSE)::int AS n,
      COUNT(*) FILTER (WHERE from_owner = FALSE AND urgent = TRUE)::int AS urgent_n,
      MAX(created_at) FILTER (WHERE from_owner = FALSE) AS last_seen,
      MIN(created_at) FILTER (WHERE from_owner = FALSE) AS first_seen
    FROM messages_log
    WHERE chat_id = ${chatId}`;
  const r = (rows[0] as {
    n: number;
    urgent_n: number;
    last_seen: Date | null;
    first_seen: Date | null;
  }) ?? { n: 0, urgent_n: 0, last_seen: null, first_seen: null };
  return {
    priorCount: Number(r.n) || 0,
    urgentCount: Number(r.urgent_n) || 0,
    lastSeen: r.last_seen ?? null,
    firstSeen: r.first_seen ?? null,
  };
}

export type AuditRow = {
  id: number;
  createdAt: Date;
  actorId: number | null;
  actorName: string | null;
  action: string;
  target: string | null;
  details: unknown;
};

export async function listAudit(limit = 100): Promise<AuditRow[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, created_at, actor_id, actor_name, action, target, details
    FROM audit_log ORDER BY created_at DESC LIMIT ${Math.min(limit, 500)}`;
  return rows.map((r) => ({
    id: Number(r.id),
    createdAt: r.created_at as Date,
    actorId: r.actor_id != null ? Number(r.actor_id) : null,
    actorName: (r.actor_name as string) ?? null,
    action: r.action as string,
    target: (r.target as string) ?? null,
    details: r.details ?? null,
  }));
}

export type CostByPurpose = {
  purpose: string;
  calls: number;
  totalCostUsd: number;
  totalTokens: number;
};

export async function aiUsageByPurpose(
  daysBack = 30,
): Promise<CostByPurpose[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT purpose,
           COUNT(*)::int AS calls,
           COALESCE(SUM(cost_usd), 0)::float8 AS cost,
           COALESCE(SUM(total_tokens), 0)::int AS tokens
    FROM ai_usage
    WHERE created_at > NOW() - make_interval(days => ${daysBack})
    GROUP BY purpose
    ORDER BY cost DESC`;
  return rows.map((r) => ({
    purpose: r.purpose as string,
    calls: Number(r.calls) || 0,
    totalCostUsd: Number(r.cost) || 0,
    totalTokens: Number(r.tokens) || 0,
  }));
}

export type CostByModel = {
  model: string;
  calls: number;
  totalCostUsd: number;
  totalTokens: number;
};

export async function aiUsageByModel(
  daysBack = 30,
): Promise<CostByModel[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT model,
           COUNT(*)::int AS calls,
           COALESCE(SUM(cost_usd), 0)::float8 AS cost,
           COALESCE(SUM(total_tokens), 0)::int AS tokens
    FROM ai_usage
    WHERE created_at > NOW() - make_interval(days => ${daysBack})
    GROUP BY model
    ORDER BY cost DESC`;
  return rows.map((r) => ({
    model: r.model as string,
    calls: Number(r.calls) || 0,
    totalCostUsd: Number(r.cost) || 0,
    totalTokens: Number(r.tokens) || 0,
  }));
}

export type CostByDay = {
  day: string;
  totalCostUsd: number;
  calls: number;
};

export async function aiUsageByDay(daysBack = 14): Promise<CostByDay[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT DATE(created_at AT TIME ZONE 'UTC') AS day,
           COALESCE(SUM(cost_usd), 0)::float8 AS cost,
           COUNT(*)::int AS calls
    FROM ai_usage
    WHERE created_at > NOW() - make_interval(days => ${daysBack})
    GROUP BY 1
    ORDER BY 1`;
  return rows.map((r) => ({
    day:
      r.day instanceof Date
        ? (r.day as Date).toISOString().slice(0, 10)
        : String(r.day),
    totalCostUsd: Number(r.cost) || 0,
    calls: Number(r.calls) || 0,
  }));
}

// --- Invites (short tokens for /start payloads) ---

export type InvitePayload = Record<string, unknown>;

export async function createInvite(args: {
  token: string;
  purpose: string;
  payload: InvitePayload;
  ttlSeconds: number;
  createdBy?: number | null;
}): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO invites (token, purpose, payload, expires_at, created_by)
    VALUES (
      ${args.token}, ${args.purpose}, ${JSON.stringify(args.payload)}::jsonb,
      NOW() + make_interval(secs => ${args.ttlSeconds}),
      ${args.createdBy ?? null}
    )`;
}

export async function consumeInvite(
  token: string,
  usedBy: number,
): Promise<{ purpose: string; payload: InvitePayload } | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    UPDATE invites
    SET used_at = NOW(), used_by = ${usedBy}
    WHERE token = ${token}
      AND used_at IS NULL
      AND expires_at > NOW()
    RETURNING purpose, payload`;
  const r = rows[0] as { purpose: string; payload: InvitePayload } | undefined;
  return r ? { purpose: r.purpose, payload: r.payload } : null;
}

export async function chatModeCounts(): Promise<Record<ChatMode, number>> {
  const empty: Record<ChatMode, number> = {
    off: 0,
    secretary: 0,
    auto_reply: 0,
    friendly_reply: 0,
    ai_chat: 0,
    ai_listen: 0,
  };
  if (!hasDb()) return empty;
  await ensureSchema();
  const rows = await sql()`
    SELECT mode, COUNT(*)::int AS n FROM chat_rules GROUP BY mode`;
  for (const r of rows) {
    const m = (r as { mode: string; n: number }).mode as ChatMode;
    if (CHAT_MODES.includes(m)) empty[m] = Number((r as { n: number }).n) || 0;
  }
  return empty;
}

// --- Extracted reminders/events/tasks ---

const VALID_PRIORITIES = new Set(["urgent", "high", "normal", "low"]);
function normalisePriority(p: string | null | undefined): string {
  const v = (p ?? "").toLowerCase().trim();
  return VALID_PRIORITIES.has(v) ? v : "normal";
}

export type ExtractedItem = {
  id: number;
  messageId: number | null;
  tgMessageId: number | null;
  chatId: number | null;
  chatTitle: string | null;
  senderName: string | null;
  kind: string;
  priority: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  location: string | null;
  participants: string[] | null;
  sourceText: string | null;
  doneAt: Date | null;
  createdAt: Date;
};

export async function saveExtractedItems(items: Array<{
  messageId: number | null;
  tgMessageId?: number | null;
  chatId: number | null;
  chatTitle: string | null;
  senderName: string | null;
  kind: string;
  priority?: string | null;
  title: string;
  description?: string | null;
  dueAt?: Date | null;
  location?: string | null;
  participants?: string[] | null;
  sourceText?: string | null;
}>): Promise<number> {
  if (!hasDb() || items.length === 0) return 0;
  await ensureSchema();
  let n = 0;
  const q = sql();
  for (const it of items) {
    await q`
      INSERT INTO extracted_items (
        message_id, tg_message_id, chat_id, chat_title, sender_name,
        kind, priority, title, description, due_at, location, participants, source_text
      ) VALUES (
        ${it.messageId}, ${it.tgMessageId ?? null}, ${it.chatId}, ${it.chatTitle}, ${it.senderName},
        ${it.kind}, ${normalisePriority(it.priority)}, ${it.title}, ${it.description ?? null},
        ${it.dueAt ? it.dueAt.toISOString() : null},
        ${it.location ?? null},
        ${it.participants ? JSON.stringify(it.participants) : null}::jsonb,
        ${it.sourceText ?? null}
      )`;
    n++;
  }
  return n;
}

function rowToExtracted(r: Record<string, unknown>): ExtractedItem {
  const p = r.participants as unknown;
  return {
    id: Number(r.id),
    messageId: r.message_id != null ? Number(r.message_id) : null,
    tgMessageId: r.tg_message_id != null ? Number(r.tg_message_id) : null,
    chatId: r.chat_id != null ? Number(r.chat_id) : null,
    chatTitle: (r.chat_title as string) ?? null,
    senderName: (r.sender_name as string) ?? null,
    kind: r.kind as string,
    priority: normalisePriority(r.priority as string | null),
    title: r.title as string,
    description: (r.description as string) ?? null,
    dueAt: (r.due_at as Date) ?? null,
    location: (r.location as string) ?? null,
    participants: Array.isArray(p) ? (p as string[]) : null,
    sourceText: (r.source_text as string) ?? null,
    doneAt: (r.done_at as Date) ?? null,
    createdAt: r.created_at as Date,
  };
}

export async function listExtractedItems(opts: {
  upcoming?: boolean;
  doneOnly?: boolean;
  priority?: string | null;
  limit?: number;
}): Promise<ExtractedItem[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const limit = Math.min(opts.limit ?? 100, 500);
  // Priority filter is applied as an extra clause to whichever base
  // query the view (upcoming / done / all) selected. null = no filter.
  const prio =
    opts.priority && VALID_PRIORITIES.has(opts.priority)
      ? opts.priority
      : null;
  const rows = opts.upcoming
    ? await sql()`
        SELECT * FROM extracted_items
        WHERE done_at IS NULL
          AND (due_at IS NULL OR due_at > NOW() - INTERVAL '1 day')
          AND (${prio}::text IS NULL OR priority = ${prio})
        ORDER BY
          COALESCE(due_at, created_at + INTERVAL '100 years') ASC,
          created_at DESC
        LIMIT ${limit}`
    : opts.doneOnly
      ? await sql()`
          SELECT * FROM extracted_items
          WHERE done_at IS NOT NULL
            AND (${prio}::text IS NULL OR priority = ${prio})
          ORDER BY done_at DESC LIMIT ${limit}`
      : await sql()`
          SELECT * FROM extracted_items
          WHERE (${prio}::text IS NULL OR priority = ${prio})
          ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map(rowToExtracted);
}

export async function markExtractedDone(id: number, done: boolean): Promise<void> {
  if (!hasDb()) return;
  if (done) {
    await sql()`UPDATE extracted_items SET done_at = NOW() WHERE id = ${id}`;
  } else {
    await sql()`UPDATE extracted_items SET done_at = NULL WHERE id = ${id}`;
  }
}

// Bulk versions: caller passes a list of ids and we run a single SQL
// per op. ANY(...) keeps the round-trip cost flat regardless of how
// many items the owner ticked.
export async function bulkMarkExtractedDone(
  ids: number[],
  done: boolean,
): Promise<number> {
  if (!hasDb() || ids.length === 0) return 0;
  const rows = done
    ? await sql()`
        UPDATE extracted_items
        SET done_at = NOW()
        WHERE id = ANY(${ids}::bigint[])
        RETURNING id`
    : await sql()`
        UPDATE extracted_items
        SET done_at = NULL
        WHERE id = ANY(${ids}::bigint[])
        RETURNING id`;
  return rows.length;
}

export async function bulkDeleteExtracted(ids: number[]): Promise<number> {
  if (!hasDb() || ids.length === 0) return 0;
  const rows = await sql()`
    DELETE FROM extracted_items
    WHERE id = ANY(${ids}::bigint[])
    RETURNING id`;
  return rows.length;
}

export async function bulkSetExtractedKind(
  ids: number[],
  kind: string,
): Promise<number> {
  if (!hasDb() || ids.length === 0) return 0;
  const rows = await sql()`
    UPDATE extracted_items
    SET kind = ${kind}
    WHERE id = ANY(${ids}::bigint[])
    RETURNING id`;
  return rows.length;
}

export async function upcomingReminderCount(): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const rows = await sql()`
    SELECT COUNT(*)::int AS n FROM extracted_items
    WHERE done_at IS NULL AND due_at IS NOT NULL AND due_at > NOW()`;
  return Number((rows[0] as { n: number })?.n) || 0;
}

// --- Knowledge base ---

export type KnowledgeEntry = {
  id: number;
  title: string;
  aliases: string[];
  body: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
};

function rowToKnowledge(r: Record<string, unknown>): KnowledgeEntry {
  const aliasesRaw = r.aliases;
  const tagsRaw = r.tags;
  const aliases =
    Array.isArray(aliasesRaw)
      ? (aliasesRaw.filter((x) => typeof x === "string") as string[])
      : [];
  const tags =
    Array.isArray(tagsRaw)
      ? (tagsRaw.filter((x) => typeof x === "string") as string[])
      : [];
  return {
    id: Number(r.id),
    title: r.title as string,
    aliases,
    body: r.body as string,
    tags,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

export async function listKnowledge(): Promise<KnowledgeEntry[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, title, aliases, body, tags, created_at, updated_at
    FROM knowledge_entries
    ORDER BY updated_at DESC`;
  return (rows as Array<Record<string, unknown>>).map(rowToKnowledge);
}

export async function getKnowledge(id: number): Promise<KnowledgeEntry | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, title, aliases, body, tags, created_at, updated_at
    FROM knowledge_entries WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToKnowledge(r) : null;
}

export async function upsertKnowledge(args: {
  id?: number;
  title: string;
  aliases: string[];
  body: string;
  tags: string[];
  createdBy?: number | null;
}): Promise<number> {
  await ensureSchema();
  const aliasesJson = JSON.stringify(args.aliases);
  const tagsJson = JSON.stringify(args.tags);
  if (args.id) {
    await sql()`
      UPDATE knowledge_entries
      SET title = ${args.title},
          aliases = ${aliasesJson}::jsonb,
          body = ${args.body},
          tags = ${tagsJson}::jsonb,
          updated_at = NOW()
      WHERE id = ${args.id}`;
    return args.id;
  }
  const rows = await sql()`
    INSERT INTO knowledge_entries (title, aliases, body, tags, created_by)
    VALUES (${args.title}, ${aliasesJson}::jsonb, ${args.body},
            ${tagsJson}::jsonb, ${args.createdBy ?? null})
    RETURNING id`;
  return Number((rows[0] as { id: string }).id);
}

export async function deleteKnowledge(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM knowledge_entries WHERE id = ${id}`;
}

// Substring match the incoming text against every knowledge entry's
// title + aliases (case-insensitive). Returns matches sorted by length
// of the matched needle so longer / more specific terms win. We do this
// in JS because the table is small (single-user app, expected <few-
// hundred entries) and matching with proper word boundaries across
// Persian + English at SQL level would be more code than it's worth.
// Persian/Arabic text written in Telegram is full of variants the
// human eye reads as the same letter but JS sees as different bytes:
// ي vs ی, ك vs ک, ة vs ه, plus invisible ZWNJ / diacritics. Without
// folding all of that into a canonical form, substring matching
// against KB titles silently misses. We also strip the standard
// Arabic harakat and the ZWNJ since they're rarely typed
// consistently.
function normaliseForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ةۀ]/g, "ه")
    .replace(/[ؤئ]/g, "ی")
    .replace(/[إأآا]/g, "ا")
    .replace(/[ً-ْٰ‌‍‎‏]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function findKnowledgeMatches(
  text: string,
  limit = 6,
): Promise<KnowledgeEntry[]> {
  if (!text) return [];
  const haystack = normaliseForMatch(text);
  if (!haystack) return [];
  const all = await listKnowledge();
  const hits: Array<{ entry: KnowledgeEntry; matched: string }> = [];
  for (const e of all) {
    const needles = [e.title, ...e.aliases]
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    let best: string | null = null;
    for (const n of needles) {
      const needle = normaliseForMatch(n);
      if (!needle) continue;
      if (haystack.includes(needle)) {
        if (!best || needle.length > best.length) best = needle;
      }
    }
    if (best) hits.push({ entry: e, matched: best });
  }
  hits.sort((a, b) => b.matched.length - a.matched.length);
  return hits.slice(0, limit).map((h) => h.entry);
}

// --- Ask queries (saved natural-language Q&A) ---

export type AskQuery = {
  id: number;
  prompt: string;
  answer: string;
  scannedMessages: number;
  days: number;
  createdAt: Date;
};

function rowToAsk(r: Record<string, unknown>): AskQuery {
  return {
    id: Number(r.id),
    prompt: r.prompt as string,
    answer: r.answer as string,
    scannedMessages: Number(r.scanned_messages),
    days: Number(r.days),
    createdAt: r.created_at as Date,
  };
}

export async function saveAskQuery(args: {
  prompt: string;
  promptHash: string;
  answer: string;
  scannedMessages: number;
  days: number;
  createdBy?: number | null;
}): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO ask_queries (
      prompt, prompt_hash, answer, scanned_messages, days, created_by
    ) VALUES (
      ${args.prompt}, ${args.promptHash}, ${args.answer},
      ${args.scannedMessages}, ${args.days}, ${args.createdBy ?? null}
    ) RETURNING id`;
  return Number((rows[0] as { id: string }).id);
}

// Find the most recent cached answer for an identical (prompt, days)
// pair within the last `ttlMinutes`. Returns null when no fresh hit
// exists; the caller can then run the AI and cache the new result.
export async function findCachedAsk(
  promptHash: string,
  days: number,
  ttlMinutes: number,
): Promise<AskQuery | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, prompt, answer, scanned_messages, days, created_at
    FROM ask_queries
    WHERE prompt_hash = ${promptHash}
      AND days = ${days}
      AND created_at > NOW() - (${ttlMinutes} || ' minutes')::INTERVAL
    ORDER BY created_at DESC
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToAsk(r) : null;
}

export async function listAskQueries(limit = 30): Promise<AskQuery[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const cap = Math.min(Math.max(limit, 1), 200);
  const rows = await sql()`
    SELECT id, prompt, answer, scanned_messages, days, created_at
    FROM ask_queries
    ORDER BY created_at DESC LIMIT ${cap}`;
  return (rows as Array<Record<string, unknown>>).map(rowToAsk);
}

export async function getAskQuery(id: number): Promise<AskQuery | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, prompt, answer, scanned_messages, days, created_at
    FROM ask_queries WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToAsk(r) : null;
}

export async function deleteAskQuery(id: number): Promise<void> {
  if (!hasDb()) return;
  await sql()`DELETE FROM ask_queries WHERE id = ${id}`;
}

// --- Monitored accounts (Instagram stories etc.) ---

export type MonitoredAccount = {
  id: number;
  platform: string;
  username: string;
  url: string | null;
  externalId: string | null;
  topicId: string | null;
  enabled: boolean;
  checkStories: boolean;
  checkPosts: boolean;
  checkReels: boolean;
  checkProfile: boolean;
  checkMentioned: boolean;
  intervalMinutes: number;
  // 'interval' = poll on a clock schedule (the default).
  // 'notify'   = wait for /api/insta-webhook to fire; cron stays off
  //              this account except for the 24h-staleness fallback.
  mode: "interval" | "notify";
  lastNotifyAt: Date | null;
  pendingFetchAt: Date | null;
  pendingNotifyKinds: string[] | null;
  instagramUserId: string | null;
  fullName: string | null;
  lastCheckedAt: Date | null;
  lastStoryAt: Date | null;
  lastError: string | null;
  lastMediaCount: number | null;
  tenantId: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function rowToMonitored(r: Record<string, unknown>): MonitoredAccount {
  const rawMode = (r.mode as string) ?? "interval";
  const mode: MonitoredAccount["mode"] =
    rawMode === "notify" ? "notify" : "interval";
  let pendingKinds: string[] | null = null;
  if (Array.isArray(r.pending_notify_kinds)) {
    pendingKinds = (r.pending_notify_kinds as unknown[]).filter(
      (x): x is string => typeof x === "string",
    );
  } else if (typeof r.pending_notify_kinds === "string") {
    try {
      const parsed = JSON.parse(r.pending_notify_kinds);
      if (Array.isArray(parsed)) {
        pendingKinds = parsed.filter(
          (x): x is string => typeof x === "string",
        );
      }
    } catch {}
  }
  return {
    id: Number(r.id),
    platform: r.platform as string,
    username: r.username as string,
    url: (r.url as string) ?? null,
    externalId: (r.external_id as string) ?? null,
    topicId: (r.topic_id as string) ?? null,
    enabled: Boolean(r.enabled),
    checkStories: r.check_stories == null ? true : Boolean(r.check_stories),
    checkPosts: Boolean(r.check_posts),
    checkReels: Boolean(r.check_reels),
    checkProfile: Boolean(r.check_profile),
    checkMentioned: Boolean(r.check_mentioned),
    intervalMinutes: Number(r.interval_minutes ?? 30),
    mode,
    lastNotifyAt: (r.last_notify_at as Date) ?? null,
    pendingFetchAt: (r.pending_fetch_at as Date) ?? null,
    pendingNotifyKinds: pendingKinds,
    instagramUserId: (r.instagram_user_id as string) ?? null,
    fullName: (r.full_name as string) ?? null,
    lastCheckedAt: (r.last_checked_at as Date) ?? null,
    lastStoryAt: (r.last_story_at as Date) ?? null,
    lastError: (r.last_error as string) ?? null,
    lastMediaCount:
      r.last_media_count == null ? null : Number(r.last_media_count),
    tenantId: r.tenant_id == null ? null : Number(r.tenant_id),
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

export async function listMonitoredAccounts(opts: {
  platform?: string;
  enabledOnly?: boolean;
  tenantId?: number | null;
} = {}): Promise<MonitoredAccount[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, platform, username, url, external_id, topic_id, enabled,
           check_stories, check_posts, check_reels, check_profile,
           check_mentioned, interval_minutes, instagram_user_id, full_name,
           last_checked_at, last_story_at, last_error, last_media_count,
           tenant_id, mode, last_notify_at, pending_fetch_at,
           pending_notify_kinds,
           created_at, updated_at
    FROM monitored_accounts
    WHERE (${opts.platform ?? null}::text IS NULL OR platform = ${opts.platform ?? null})
      AND (${opts.enabledOnly ?? false}::boolean = FALSE OR enabled = TRUE)
      AND (${opts.tenantId ?? null}::bigint IS NULL OR tenant_id = ${opts.tenantId ?? null})
    ORDER BY username ASC`;
  return (rows as Array<Record<string, unknown>>).map(rowToMonitored);
}

// Bulk upsert from CSV import. Updates URL / external_id / topic_id
// for existing rows but DOESN'T clobber the enabled flag (the owner
// might have manually disabled an account).
export async function upsertMonitoredAccounts(
  items: Array<{
    platform: string;
    username: string;
    url?: string | null;
    externalId?: string | null;
    topicId?: string | null;
  }>,
  tenantId?: number | null,
): Promise<{ inserted: number; updated: number; insertedIds: number[] }> {
  if (!hasDb() || items.length === 0)
    return { inserted: 0, updated: 0, insertedIds: [] };
  await ensureSchema();
  let inserted = 0;
  let updated = 0;
  const insertedIds: number[] = [];
  for (const it of items) {
    const username = it.username.trim().toLowerCase();
    if (!username) continue;
    const rows = await sql()`
      INSERT INTO monitored_accounts (
        platform, username, url, external_id, topic_id, tenant_id
      )
      VALUES (${it.platform}, ${username}, ${it.url ?? null},
              ${it.externalId ?? null}, ${it.topicId ?? null},
              ${tenantId ?? null})
      ON CONFLICT (platform, username) DO UPDATE SET
        url = COALESCE(EXCLUDED.url, monitored_accounts.url),
        external_id = COALESCE(EXCLUDED.external_id, monitored_accounts.external_id),
        topic_id = COALESCE(EXCLUDED.topic_id, monitored_accounts.topic_id),
        tenant_id = COALESCE(monitored_accounts.tenant_id, EXCLUDED.tenant_id),
        updated_at = NOW()
      RETURNING id, (xmax = 0) AS was_inserted`;
    const r = rows[0] as { id: string; was_inserted: boolean } | undefined;
    if (!r) continue;
    if (r.was_inserted) {
      inserted++;
      insertedIds.push(Number(r.id));
    } else {
      updated++;
    }
  }
  return { inserted, updated, insertedIds };
}

export async function setMonitoredAccountEnabled(
  id: number,
  enabled: boolean,
  tenantId?: number | null,
): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE monitored_accounts
    SET enabled = ${enabled}, updated_at = NOW()
    WHERE id = ${id}
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})`;
}

export async function deleteMonitoredAccount(
  id: number,
  tenantId?: number | null,
): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    DELETE FROM monitored_accounts
    WHERE id = ${id}
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})`;
}

export async function getMonitoredAccount(
  id: number,
  tenantId?: number | null,
): Promise<MonitoredAccount | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, platform, username, url, external_id, topic_id, enabled,
           check_stories, check_posts, check_reels, check_profile,
           check_mentioned, interval_minutes, instagram_user_id, full_name,
           last_checked_at, last_story_at, last_error, last_media_count,
           tenant_id, mode, last_notify_at, pending_fetch_at,
           pending_notify_kinds,
           created_at, updated_at
    FROM monitored_accounts
    WHERE id = ${id}
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToMonitored(r) : null;
}

// Find accounts that should be polled next: enabled and their own
// per-account interval_minutes has elapsed since last_checked_at
// (or never checked). Oldest first so the backlog drains evenly.
export async function dueMonitoredAccounts(
  limit = 50,
  tenantId?: number | null,
): Promise<MonitoredAccount[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  // Peak-hours gate. The cron runs every 5 min, but for each
  // interval bucket we only let it fire during a curated set of
  // Tehran-time hours (Asia/Tehran). The operator's hard rule:
  // intervals SHORTER than 12 hours (3h, 6h) must NEVER run during
  // the very-late-night quiet window of 02:00–08:00 Tehran. The
  // schedules below all respect that — 3h fires no earlier than
  // 09:00, 6h no earlier than 10:00 — so an account on a < 12h
  // interval has at least a 9-hour overnight gap with no calls.
  //
  //   3h  → 09, 12, 15, 18, 21    (five daytime/evening slots)
  //   6h  → 10, 16, 22            (three slots: morning, late afternoon, late evening)
  //   12h → 10, 22                (two slots, exactly 12h apart)
  //   24h → 19                    (one slot at evening peak)
  //
  // For never-checked accounts (last_checked_at IS NULL) we ignore
  // the hour gate so a brand-new account doesn't wait until 19:00
  // Tehran for its first run — addMonitoredAccount also kicks an
  // immediate processAccount() but this is defence in depth.
  //
  // Strict interval `last_checked_at < NOW() - interval_minutes`
  // can miss a trigger that lands at the same minute, so we relax
  // it to 95% — i.e. an account that was checked within the last
  // 5% of its window is still considered due. This handles the
  // 5-minute cron drift around a hourly trigger.
  const rows = await sql()`
    SELECT id, platform, username, url, external_id, topic_id, enabled,
           check_stories, check_posts, check_reels, check_profile,
           check_mentioned, interval_minutes, instagram_user_id, full_name,
           last_checked_at, last_story_at, last_error, last_media_count,
           tenant_id, mode, last_notify_at, pending_fetch_at,
           pending_notify_kinds,
           created_at, updated_at
    FROM monitored_accounts
    WHERE enabled = TRUE
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})
      AND (
        -- Path A: 'interval' mode on the standard schedule.
        (
          mode = 'interval'
          AND (last_checked_at IS NULL
               OR last_checked_at < NOW() - ((interval_minutes * 0.95) || ' minutes')::INTERVAL)
          AND (
            last_checked_at IS NULL
            OR CASE
              WHEN interval_minutes = 180 THEN
                EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Tehran'))::INT
                  IN (9, 12, 15, 18, 21)
              WHEN interval_minutes = 360 THEN
                EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Tehran'))::INT
                  IN (10, 16, 22)
              WHEN interval_minutes = 720 THEN
                EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Tehran'))::INT
                  IN (10, 22)
              WHEN interval_minutes = 1440 THEN
                EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Tehran'))::INT
                  = 19
              ELSE TRUE
            END
          )
        )
        OR
        -- Path B: 'notify' mode with a pending fetch that's now due
        -- (the 3-hour cooldown elapsed OR the deferred-to-peak time
        -- arrived). pending_fetch_at is in the past once due.
        (
          mode = 'notify'
          AND pending_fetch_at IS NOT NULL
          AND pending_fetch_at <= NOW()
        )
        OR
        -- Path C: 24h staleness fallback. Any account (notify or
        -- interval) that hasn't been touched in 24+ hours is treated
        -- like a 24h-interval account — only fires at the 19:00
        -- Tehran peak slot. Keeps notify-mode accounts moving even
        -- if the external service is down.
        (
          last_checked_at IS NOT NULL
          AND last_checked_at < NOW() - INTERVAL '24 hours'
          AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Tehran'))::INT = 19
        )
      )
    ORDER BY last_checked_at NULLS FIRST, id ASC
    LIMIT ${limit}`;
  return (rows as Array<Record<string, unknown>>).map(rowToMonitored);
}

// --- Notify-mode helpers ---

// Record an inbound webhook hit. Returns the updated row so the
// caller can act on the pending_fetch_at the cron now sees. Logic:
//   1. If the account was last NOTIFIED less than 3 hours ago AND
//      already has a pending fetch queued, just append the requested
//      kinds to pending_notify_kinds and leave pending_fetch_at
//      unchanged.
//   2. Otherwise schedule pending_fetch_at = last_notify_at + 3h
//      (or NOW + 3h if no last_notify_at). That's the 3-hour
//      cool-down "worst-case cost" guarantee the operator asked for.
//      Also snap forward to the next allowed peak hour if the
//      computed time falls inside the 02-08 quiet window.
//   3. Always touch last_notify_at to NOW.
// The actual fetch happens later in the cron when pending_fetch_at
// <= NOW — see Path B in dueMonitoredAccounts.
export async function recordInstaNotify(args: {
  username: string;
  kinds: string[];
  tenantId?: number | null;
}): Promise<MonitoredAccount | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const username = args.username.trim().toLowerCase();
  if (!username) return null;
  const tenantId = args.tenantId ?? null;
  // Fetch current state first so we know what kinds to merge.
  const cur = await sql()`
    SELECT id, platform, username, mode, last_notify_at,
           pending_fetch_at, pending_notify_kinds
    FROM monitored_accounts
    WHERE platform = 'instagram'
      AND lower(username) = ${username}
      AND (${tenantId}::bigint IS NULL OR tenant_id = ${tenantId})
    LIMIT 1`;
  const r0 = cur[0] as Record<string, unknown> | undefined;
  if (!r0) return null;
  const existingKinds = Array.isArray(r0.pending_notify_kinds)
    ? (r0.pending_notify_kinds as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
  const mergedKinds = Array.from(new Set([...existingKinds, ...args.kinds]));
  const rows = await sql()`
    UPDATE monitored_accounts
    SET
      last_notify_at = NOW(),
      pending_notify_kinds = ${JSON.stringify(mergedKinds)}::jsonb,
      pending_fetch_at = CASE
        -- If there's already a pending fetch queued, leave it alone.
        WHEN pending_fetch_at IS NOT NULL THEN pending_fetch_at
        -- Otherwise: schedule for last_notify_at + 3h, or NOW + 3h
        -- when this is the first notify. If the resulting time falls
        -- inside the 02-08 Tehran quiet window, snap forward to 08:00
        -- the same Tehran day.
        ELSE GREATEST(
          NOW() + INTERVAL '3 hours',
          COALESCE(last_notify_at, NOW()) + INTERVAL '3 hours'
        )
      END,
      updated_at = NOW()
    WHERE id = ${Number(r0.id)}
    RETURNING id, platform, username, url, external_id, topic_id, enabled,
              check_stories, check_posts, check_reels, check_profile,
              check_mentioned, interval_minutes, instagram_user_id, full_name,
              last_checked_at, last_story_at, last_error, last_media_count,
              tenant_id, mode, last_notify_at, pending_fetch_at,
              pending_notify_kinds, created_at, updated_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToMonitored(r) : null;
}

// Called by the cron after a notify-mode account has been processed.
// Clears the pending queue so the next notify starts a fresh 3-hour
// window.
export async function clearMonitoredAccountPending(
  id: number,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE monitored_accounts
    SET pending_fetch_at = NULL,
        pending_notify_kinds = NULL,
        updated_at = NOW()
    WHERE id = ${id}`;
}

// Operator tapped "🔍 الان بگیر" on a deferred notify message:
// move pending_fetch_at to NOW so the next cron tick (≤ 5 min)
// processes it.
export async function expediteMonitoredAccountFetch(
  id: number,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE monitored_accounts
    SET pending_fetch_at = NOW(),
        updated_at = NOW()
    WHERE id = ${id}
      AND mode = 'notify'`;
}

export async function setMonitoredAccountMode(args: {
  id: number;
  mode: "interval" | "notify";
  tenantId?: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE monitored_accounts
    SET mode = ${args.mode},
        pending_fetch_at = NULL,
        pending_notify_kinds = NULL,
        updated_at = NOW()
    WHERE id = ${args.id}
      AND (${args.tenantId ?? null}::bigint IS NULL
           OR tenant_id = ${args.tenantId ?? null}::bigint)`;
}

// Manual add: insert a single account by username. Pulls defaults
// (which kinds to check + how often) from the settings table so the
// owner can control behaviour of newly-added accounts in one place.
export async function addMonitoredAccount(args: {
  platform: string;
  username: string;
  url?: string | null;
  tenantId?: number | null;
  defaults?: {
    intervalMinutes?: number;
    checkStories?: boolean;
    checkPosts?: boolean;
    checkReels?: boolean;
    checkProfile?: boolean;
    checkMentioned?: boolean;
  };
}): Promise<MonitoredAccount | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const username = args.username.trim().toLowerCase();
  if (!username) return null;
  const d = args.defaults ?? {};
  const rows = await sql()`
    INSERT INTO monitored_accounts (
      platform, username, url, interval_minutes,
      check_stories, check_posts, check_reels, check_profile, check_mentioned,
      tenant_id
    )
    VALUES (
      ${args.platform}, ${username},
      ${args.url ?? `https://instagram.com/${username}`},
      ${Math.max(180, d.intervalMinutes ?? 720)},
      ${d.checkStories ?? true},
      ${d.checkPosts ?? false},
      ${d.checkReels ?? false},
      ${d.checkProfile ?? false},
      ${d.checkMentioned ?? false},
      ${args.tenantId ?? null}
    )
    ON CONFLICT (platform, username) DO UPDATE SET
      updated_at = NOW(),
      tenant_id = COALESCE(monitored_accounts.tenant_id, EXCLUDED.tenant_id)
    RETURNING id, platform, username, url, external_id, topic_id, enabled,
              check_stories, check_posts, check_reels, check_profile,
              check_mentioned, interval_minutes, instagram_user_id, full_name,
              last_checked_at, last_story_at, last_error, last_media_count,
              tenant_id, mode, last_notify_at, pending_fetch_at,
              pending_notify_kinds,
              created_at, updated_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToMonitored(r) : null;
}

export async function updateMonitoredAccountConfig(
  id: number,
  patch: {
    checkStories?: boolean;
    checkPosts?: boolean;
    checkReels?: boolean;
    checkProfile?: boolean;
    checkMentioned?: boolean;
    intervalMinutes?: number;
    mode?: "interval" | "notify";
  },
  tenantId?: number | null,
): Promise<void> {
  if (!hasDb()) return;
  // When the operator flips an account out of notify mode we wipe
  // the pending queue so a stale notify doesn't fire after the
  // switch.
  const modeChanged = patch.mode !== undefined;
  await sql()`
    UPDATE monitored_accounts SET
      check_stories = COALESCE(${patch.checkStories ?? null}, check_stories),
      check_posts = COALESCE(${patch.checkPosts ?? null}, check_posts),
      check_reels = COALESCE(${patch.checkReels ?? null}, check_reels),
      check_profile = COALESCE(${patch.checkProfile ?? null}, check_profile),
      check_mentioned = COALESCE(${patch.checkMentioned ?? null}, check_mentioned),
      interval_minutes = COALESCE(${
        patch.intervalMinutes ?? null
      }::int, interval_minutes),
      mode = COALESCE(${patch.mode ?? null}::text, mode),
      pending_fetch_at = CASE
        WHEN ${modeChanged}::boolean THEN NULL
        ELSE pending_fetch_at
      END,
      pending_notify_kinds = CASE
        WHEN ${modeChanged}::boolean THEN NULL
        ELSE pending_notify_kinds
      END,
      updated_at = NOW()
    WHERE id = ${id}
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})`;
}

// Bulk patch for the /monitored bulk toolbar. Any undefined field is
// left alone. `resetError=true` clears last_error AND last_checked_at
// so the next cron tick re-tries the account immediately instead of
// waiting for interval_minutes to elapse.
export async function bulkUpdateMonitoredAccounts(
  ids: number[],
  patch: {
    enabled?: boolean;
    checkStories?: boolean;
    checkPosts?: boolean;
    checkReels?: boolean;
    checkProfile?: boolean;
    checkMentioned?: boolean;
    intervalMinutes?: number;
    resetError?: boolean;
  },
  tenantId?: number | null,
): Promise<number> {
  if (!hasDb() || ids.length === 0) return 0;
  const reset = patch.resetError === true;
  const rows = await sql()`
    UPDATE monitored_accounts SET
      enabled = COALESCE(${patch.enabled ?? null}::boolean, enabled),
      check_stories = COALESCE(${patch.checkStories ?? null}::boolean, check_stories),
      check_posts = COALESCE(${patch.checkPosts ?? null}::boolean, check_posts),
      check_reels = COALESCE(${patch.checkReels ?? null}::boolean, check_reels),
      check_profile = COALESCE(${patch.checkProfile ?? null}::boolean, check_profile),
      check_mentioned = COALESCE(${patch.checkMentioned ?? null}::boolean, check_mentioned),
      interval_minutes = COALESCE(${
        patch.intervalMinutes ?? null
      }::int, interval_minutes),
      last_error = CASE WHEN ${reset}::boolean THEN NULL ELSE last_error END,
      last_checked_at = CASE WHEN ${reset}::boolean THEN NULL ELSE last_checked_at END,
      updated_at = NOW()
    WHERE id = ANY(${ids}::bigint[])
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})
    RETURNING id`;
  return rows.length;
}

// Single-row reset helper — same semantics as the bulk version but
// for one account. Returns true if a row was touched.
export async function resetMonitoredAccountError(
  id: number,
  tenantId?: number | null,
): Promise<boolean> {
  if (!hasDb()) return false;
  const rows = await sql()`
    UPDATE monitored_accounts
    SET last_error = NULL,
        last_checked_at = NULL,
        updated_at = NOW()
    WHERE id = ${id}
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})
    RETURNING id`;
  return rows.length > 0;
}

export async function bulkDeleteMonitoredAccounts(
  ids: number[],
  tenantId?: number | null,
): Promise<number> {
  if (!hasDb() || ids.length === 0) return 0;
  const rows = await sql()`
    DELETE FROM monitored_accounts
    WHERE id = ANY(${ids}::bigint[])
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})
    RETURNING id`;
  return rows.length;
}

export async function setInstagramUserId(
  id: number,
  igUserId: string,
  fullName?: string | null,
): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE monitored_accounts
    SET instagram_user_id = ${igUserId},
        full_name = COALESCE(${fullName ?? null}, full_name),
        updated_at = NOW()
    WHERE id = ${id}`;
}

export async function markMonitoredChecked(args: {
  id: number;
  lastStoryAt?: Date | null;
  error?: string | null;
  lastMediaCount?: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE monitored_accounts
    SET last_checked_at = NOW(),
        last_story_at = COALESCE(${args.lastStoryAt
          ? args.lastStoryAt.toISOString()
          : null}::timestamptz, last_story_at),
        last_error = ${args.error ?? null},
        last_media_count = COALESCE(${args.lastMediaCount ?? null}::int, last_media_count),
        updated_at = NOW()
    WHERE id = ${args.id}`;
}

// --- HikerAPI per-call cost log ---

export async function recordHikerCall(args: {
  endpoint: string;
  costUsd: number;
  accountId?: number | null;
  tenantId?: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    INSERT INTO hikerapi_usage (endpoint, cost_usd, account_id, tenant_id)
    VALUES (${args.endpoint}, ${args.costUsd.toFixed(6)},
            ${args.accountId ?? null}, ${args.tenantId ?? null})`;
}

// Tenant-scoped total spend — used by hikerapi-budget.ts.
export async function getHikerSpentForTenant(tenantId: number): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const rows = await sql()`
    SELECT COALESCE(SUM(cost_usd), 0)::float8 AS total
    FROM hikerapi_usage
    WHERE tenant_id = ${tenantId}`;
  const r = rows[0] as { total: number } | undefined;
  return r ? Number(r.total) : 0;
}

// Legacy global helper — used by admin views and the global usage
// summary. Filters by tenant when provided.
export async function getHikerTotalSpent(tenantId?: number | null): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const rows =
    tenantId != null
      ? await sql()`
          SELECT COALESCE(SUM(cost_usd), 0)::float8 AS total
          FROM hikerapi_usage
          WHERE tenant_id = ${tenantId}`
      : await sql()`SELECT COALESCE(SUM(cost_usd), 0)::float8 AS total FROM hikerapi_usage`;
  const r = rows[0] as { total: number } | undefined;
  return r ? Number(r.total) : 0;
}

export async function getHikerSpentBuckets(args: {
  bucket: "hour" | "day" | "week" | "month";
  since: Date;
  tenantId?: number | null;
}): Promise<Array<{ at: Date; calls: number; costUsd: number }>> {
  if (!hasDb()) return [];
  await ensureSchema();
  const truncFn =
    args.bucket === "hour"
      ? "hour"
      : args.bucket === "day"
        ? "day"
        : args.bucket === "week"
          ? "week"
          : "month";
  const rows =
    args.tenantId != null
      ? await sql()`
          SELECT date_trunc(${truncFn}, called_at) AS at,
                 COUNT(*)::int AS calls,
                 COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
          FROM hikerapi_usage
          WHERE called_at >= ${args.since.toISOString()}::timestamptz
            AND tenant_id = ${args.tenantId}
          GROUP BY 1
          ORDER BY 1 ASC`
      : await sql()`
          SELECT date_trunc(${truncFn}, called_at) AS at,
                 COUNT(*)::int AS calls,
                 COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
          FROM hikerapi_usage
          WHERE called_at >= ${args.since.toISOString()}::timestamptz
          GROUP BY 1
          ORDER BY 1 ASC`;
  return (rows as Array<{ at: Date; calls: number; cost_usd: number }>).map(
    (r) => ({ at: r.at, calls: r.calls, costUsd: Number(r.cost_usd) }),
  );
}

export async function getHikerWindowSummary(
  since: Date | null,
  tenantId?: number | null,
): Promise<{ calls: number; costUsd: number }> {
  if (!hasDb()) return { calls: 0, costUsd: 0 };
  await ensureSchema();
  let rows;
  if (since && tenantId != null) {
    rows = await sql()`
      SELECT COUNT(*)::int AS calls,
             COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
      FROM hikerapi_usage
      WHERE called_at >= ${since.toISOString()}::timestamptz
        AND tenant_id = ${tenantId}`;
  } else if (since) {
    rows = await sql()`
      SELECT COUNT(*)::int AS calls,
             COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
      FROM hikerapi_usage
      WHERE called_at >= ${since.toISOString()}::timestamptz`;
  } else if (tenantId != null) {
    rows = await sql()`
      SELECT COUNT(*)::int AS calls,
             COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
      FROM hikerapi_usage
      WHERE tenant_id = ${tenantId}`;
  } else {
    rows = await sql()`
      SELECT COUNT(*)::int AS calls,
             COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
      FROM hikerapi_usage`;
  }
  const r = rows[0] as { calls: number; cost_usd: number } | undefined;
  return r ? { calls: r.calls, costUsd: Number(r.cost_usd) } : { calls: 0, costUsd: 0 };
}

export async function listRecentHikerCalls(
  limit = 30,
  tenantId?: number | null,
): Promise<Array<{ id: number; calledAt: Date; endpoint: string; costUsd: number; accountId: number | null }>> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows =
    tenantId != null
      ? await sql()`
          SELECT id, called_at, endpoint, cost_usd::float8 AS cost_usd, account_id
          FROM hikerapi_usage
          WHERE tenant_id = ${tenantId}
          ORDER BY called_at DESC
          LIMIT ${limit}`
      : await sql()`
          SELECT id, called_at, endpoint, cost_usd::float8 AS cost_usd, account_id
          FROM hikerapi_usage
          ORDER BY called_at DESC
          LIMIT ${limit}`;
  return (rows as Array<{
    id: string;
    called_at: Date;
    endpoint: string;
    cost_usd: number;
    account_id: string | null;
  }>).map((r) => ({
    id: Number(r.id),
    calledAt: r.called_at,
    endpoint: r.endpoint,
    costUsd: Number(r.cost_usd),
    accountId: r.account_id == null ? null : Number(r.account_id),
  }));
}

// Story-detection event log. story_id is whatever the source API
// returned (could be a string, a numeric id, or our hash). Used to
// dedupe so we don't forward the same story twice.
export type MonitorEvent = {
  id: number;
  accountId: number;
  storyId: string | null;
  storyUrl: string | null;
  detectedAt: Date;
  forwardedChatId: number | null;
  forwardedMessageId: number | null;
  forwardedAt: Date | null;
  status: string;
  error: string | null;
};

export async function recordMonitorEvent(args: {
  accountId: number;
  storyId: string;
  storyUrl: string | null;
  kind?: string;
  caption?: string | null;
  mediaType?: string | null;
  tenantId?: number | null;
}): Promise<MonitorEvent | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO monitor_events (
      account_id, story_id, story_url, kind, caption, media_type, status,
      tenant_id
    )
    VALUES (${args.accountId}, ${args.storyId}, ${args.storyUrl},
            ${args.kind ?? "story"}, ${args.caption ?? null},
            ${args.mediaType ?? null}, 'detected',
            ${args.tenantId ?? null})
    ON CONFLICT (account_id, story_id) DO NOTHING
    RETURNING id, account_id, story_id, story_url, detected_at,
              forwarded_chat_id, forwarded_message_id, forwarded_at, status, error`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    accountId: Number(r.account_id),
    storyId: (r.story_id as string) ?? null,
    storyUrl: (r.story_url as string) ?? null,
    detectedAt: r.detected_at as Date,
    forwardedChatId:
      r.forwarded_chat_id != null ? Number(r.forwarded_chat_id) : null,
    forwardedMessageId:
      r.forwarded_message_id != null ? Number(r.forwarded_message_id) : null,
    forwardedAt: (r.forwarded_at as Date) ?? null,
    status: r.status as string,
    error: (r.error as string) ?? null,
  };
}

export async function markMonitorEventForwarded(args: {
  id: number;
  chatId: number;
  messageId: number;
}): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE monitor_events
    SET forwarded_chat_id = ${args.chatId},
        forwarded_message_id = ${args.messageId},
        forwarded_at = NOW(),
        status = 'forwarded'
    WHERE id = ${args.id}`;
}

export async function markMonitorEventError(args: {
  id: number;
  error: string;
}): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE monitor_events
    SET status = 'error', error = ${args.error}
    WHERE id = ${args.id}`;
}

export async function listRecentMonitorEvents(
  limit = 50,
  tenantId?: number | null,
  offset = 0,
): Promise<
  Array<MonitorEvent & { username: string | null; platform: string | null }>
> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT e.id, e.account_id, e.story_id, e.story_url, e.detected_at,
           e.forwarded_chat_id, e.forwarded_message_id, e.forwarded_at,
           e.status, e.error,
           a.username, a.platform
    FROM monitor_events e
    LEFT JOIN monitored_accounts a ON a.id = e.account_id
    WHERE (${tenantId ?? null}::bigint IS NULL OR e.tenant_id = ${tenantId ?? null})
    ORDER BY e.detected_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 500)}
    OFFSET ${Math.max(offset, 0)}`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    accountId: Number(r.account_id),
    storyId: (r.story_id as string) ?? null,
    storyUrl: (r.story_url as string) ?? null,
    detectedAt: r.detected_at as Date,
    forwardedChatId:
      r.forwarded_chat_id != null ? Number(r.forwarded_chat_id) : null,
    forwardedMessageId:
      r.forwarded_message_id != null ? Number(r.forwarded_message_id) : null,
    forwardedAt: (r.forwarded_at as Date) ?? null,
    status: r.status as string,
    error: (r.error as string) ?? null,
    username: (r.username as string) ?? null,
    platform: (r.platform as string) ?? null,
  }));
}

// Telegram retries the webhook if we don't ACK within ~25s. With slow
// AI calls + sendChatAction delays we can hit that, and the retry
// would otherwise re-run the handler and produce a duplicate reply
// (sometimes landing several messages later in the chat). Insert
// every update_id once; if it's already there, drop the retry.
// Returns true if the update is new, false if it's a duplicate.
export async function markUpdateProcessed(
  updateId: number,
  meta?: {
    updateType?: string | null;
    chatId?: number | null;
    preview?: string | null;
  },
): Promise<boolean> {
  if (!hasDb()) return true;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO processed_updates (update_id, update_type, chat_id, preview)
    VALUES (
      ${updateId},
      ${meta?.updateType ?? null},
      ${meta?.chatId ?? null},
      ${(meta?.preview ?? null)?.slice(0, 200) ?? null}
    )
    ON CONFLICT (update_id) DO NOTHING
    RETURNING update_id`;
  return rows.length > 0;
}

export async function recentUpdateCounts(
  windowMinutes = 60,
): Promise<{
  total: number;
  byType: Record<string, number>;
  recent: Array<{
    updateId: number;
    updateType: string | null;
    chatId: number | null;
    preview: string | null;
    processedAt: Date;
  }>;
}> {
  if (!hasDb()) {
    return { total: 0, byType: {}, recent: [] };
  }
  await ensureSchema();
  const rows = (await sql()`
    SELECT update_id, update_type, chat_id, preview, processed_at
    FROM processed_updates
    WHERE processed_at > NOW() - (${windowMinutes} || ' minutes')::INTERVAL
    ORDER BY processed_at DESC
    LIMIT 50`) as Array<{
    update_id: string;
    update_type: string | null;
    chat_id: string | null;
    preview: string | null;
    processed_at: Date;
  }>;
  const byType: Record<string, number> = {};
  for (const r of rows) {
    const k = r.update_type ?? "(unknown)";
    byType[k] = (byType[k] ?? 0) + 1;
  }
  return {
    total: rows.length,
    byType,
    recent: rows.map((r) => ({
      updateId: Number(r.update_id),
      updateType: r.update_type,
      chatId: r.chat_id != null ? Number(r.chat_id) : null,
      preview: r.preview,
      processedAt: r.processed_at,
    })),
  };
}

// --- Natural-language message rules ---

export type MessageRule = {
  id: number;
  tenantId: number | null;
  name: string;
  description: string;
  forwardFormat: string | null;
  requestTrigger: string | null;
  requestWindowSeconds: number | null;
  showRulePrefix: boolean;
  formatAsOtp: boolean;
  enabled: boolean;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RuleRecipient = {
  ruleId: number;
  recipientChatId: number;
  recipientLabel: string | null;
  createdAt: Date;
};

export type RuleMatch = {
  id: number;
  ruleId: number;
  messageLogId: number;
  formattedText: string | null;
  forwardedTo: number[];
  matchedAt: Date;
};

function rowToRule(r: Record<string, unknown>): MessageRule {
  return {
    id: Number(r.id),
    tenantId: r.tenant_id != null ? Number(r.tenant_id) : null,
    name: r.name as string,
    description: r.description as string,
    forwardFormat: (r.forward_format as string) ?? null,
    requestTrigger: (r.request_trigger as string) ?? null,
    requestWindowSeconds:
      r.request_window_seconds != null
        ? Number(r.request_window_seconds)
        : null,
    showRulePrefix:
      r.show_rule_prefix == null ? true : Boolean(r.show_rule_prefix),
    formatAsOtp: Boolean(r.format_as_otp),
    enabled: Boolean(r.enabled),
    createdBy: r.created_by != null ? Number(r.created_by) : null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

export async function listMessageRules(args?: {
  enabledOnly?: boolean;
  tenantId?: number | null;
}): Promise<MessageRule[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const enabledOnly = args?.enabledOnly ?? false;
  const tenantId = args?.tenantId ?? null;
  const rows = await sql()`
    SELECT id, tenant_id, name, description, forward_format,
           request_trigger, request_window_seconds,
           show_rule_prefix, format_as_otp, enabled,
           created_by, created_at, updated_at
    FROM message_rules
    WHERE (${enabledOnly}::boolean = FALSE OR enabled = TRUE)
      AND (${tenantId}::bigint IS NULL OR tenant_id IS NULL OR tenant_id = ${tenantId}::bigint)
    ORDER BY created_at DESC`;
  return (rows as Array<Record<string, unknown>>).map(rowToRule);
}

export async function getMessageRule(id: number): Promise<MessageRule | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, tenant_id, name, description, forward_format,
           request_trigger, request_window_seconds,
           show_rule_prefix, format_as_otp, enabled,
           created_by, created_at, updated_at
    FROM message_rules WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToRule(r) : null;
}

export async function createMessageRule(args: {
  name: string;
  description: string;
  forwardFormat?: string | null;
  enabled?: boolean;
  createdBy?: number | null;
  tenantId?: number | null;
}): Promise<MessageRule> {
  if (!hasDb()) throw new Error("DATABASE_URL not set");
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO message_rules (tenant_id, name, description, forward_format, enabled, created_by)
    VALUES (
      ${args.tenantId ?? null},
      ${args.name},
      ${args.description},
      ${args.forwardFormat ?? null},
      ${args.enabled ?? true},
      ${args.createdBy ?? null}
    )
    RETURNING id, tenant_id, name, description, forward_format,
              request_trigger, request_window_seconds,
              show_rule_prefix, format_as_otp,
              enabled, created_by, created_at, updated_at`;
  return rowToRule(rows[0] as Record<string, unknown>);
}

export async function updateMessageRule(
  id: number,
  patch: Partial<{
    name: string;
    description: string;
    forwardFormat: string | null;
    requestTrigger: string | null;
    requestWindowSeconds: number | null;
    showRulePrefix: boolean;
    formatAsOtp: boolean;
    enabled: boolean;
  }>,
): Promise<MessageRule | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  // Nullable fields use a marker+value pair so we can tell "leave alone"
  // (undefined) from "set to NULL" (null).
  const ffMarker = patch.forwardFormat === undefined ? 0 : 1;
  const ffValue = patch.forwardFormat ?? null;
  const rtMarker = patch.requestTrigger === undefined ? 0 : 1;
  const rtValue = patch.requestTrigger ?? null;
  const rwMarker = patch.requestWindowSeconds === undefined ? 0 : 1;
  const rwValue = patch.requestWindowSeconds ?? null;
  const rows = await sql()`
    UPDATE message_rules SET
      name = COALESCE(${patch.name ?? null}, name),
      description = COALESCE(${patch.description ?? null}, description),
      forward_format = CASE WHEN ${ffMarker}::int = 1 THEN ${ffValue} ELSE forward_format END,
      request_trigger = CASE WHEN ${rtMarker}::int = 1 THEN ${rtValue} ELSE request_trigger END,
      request_window_seconds = CASE WHEN ${rwMarker}::int = 1 THEN ${rwValue}::int ELSE request_window_seconds END,
      show_rule_prefix = COALESCE(${patch.showRulePrefix ?? null}::boolean, show_rule_prefix),
      format_as_otp = COALESCE(${patch.formatAsOtp ?? null}::boolean, format_as_otp),
      enabled = COALESCE(${patch.enabled ?? null}::boolean, enabled),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, tenant_id, name, description, forward_format,
              request_trigger, request_window_seconds,
              show_rule_prefix, format_as_otp,
              enabled, created_by, created_at, updated_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToRule(r) : null;
}

export async function deleteMessageRule(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM message_rule_matches WHERE rule_id = ${id}`;
  await sql()`DELETE FROM message_rule_recipients WHERE rule_id = ${id}`;
  await sql()`DELETE FROM message_rules WHERE id = ${id}`;
}

export async function listRuleRecipients(
  ruleId: number,
): Promise<RuleRecipient[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT rule_id, recipient_chat_id, recipient_label, created_at
    FROM message_rule_recipients
    WHERE rule_id = ${ruleId}
    ORDER BY created_at ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    ruleId: Number(r.rule_id),
    recipientChatId: Number(r.recipient_chat_id),
    recipientLabel: (r.recipient_label as string) ?? null,
    createdAt: r.created_at as Date,
  }));
}

export async function addRuleRecipient(args: {
  ruleId: number;
  recipientChatId: number;
  recipientLabel?: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO message_rule_recipients (rule_id, recipient_chat_id, recipient_label)
    VALUES (${args.ruleId}, ${args.recipientChatId}, ${args.recipientLabel ?? null})
    ON CONFLICT (rule_id, recipient_chat_id) DO UPDATE SET
      recipient_label = COALESCE(EXCLUDED.recipient_label, message_rule_recipients.recipient_label)`;
}

export async function removeRuleRecipient(args: {
  ruleId: number;
  recipientChatId: number;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    DELETE FROM message_rule_recipients
    WHERE rule_id = ${args.ruleId}
      AND recipient_chat_id = ${args.recipientChatId}`;
}

export async function recordRuleMatch(args: {
  ruleId: number;
  messageLogId: number;
  formattedText?: string | null;
  forwardedTo: number[];
  forwardErrors?: Record<string, string>;
}): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const errs = args.forwardErrors ?? {};
  const errsJson = Object.keys(errs).length > 0 ? JSON.stringify(errs) : null;
  const rows = await sql()`
    INSERT INTO message_rule_matches (rule_id, message_log_id, formatted_text, forwarded_to, forward_errors)
    VALUES (
      ${args.ruleId},
      ${args.messageLogId},
      ${args.formattedText ?? null},
      ${args.forwardedTo}::bigint[],
      ${errsJson}::jsonb
    )
    RETURNING id`;
  return Number((rows[0] as { id: string }).id);
}

export async function appendForwardErrors(args: {
  matchId: number;
  errors: Record<string, string>;
}): Promise<void> {
  if (!hasDb()) return;
  if (Object.keys(args.errors).length === 0) return;
  await ensureSchema();
  await sql()`
    UPDATE message_rule_matches
    SET forward_errors = COALESCE(forward_errors, '{}'::jsonb) || ${JSON.stringify(args.errors)}::jsonb
    WHERE id = ${args.matchId}`;
}

export async function listRuleMatches(args: {
  ruleId: number;
  limit?: number;
  offset?: number;
}): Promise<
  Array<
    RuleMatch & {
      messageText: string;
      senderName: string;
      chatId: number;
      forwardErrors: Record<string, string> | null;
    }
  >
> {
  if (!hasDb()) return [];
  await ensureSchema();
  const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
  const offset = Math.max(args.offset ?? 0, 0);
  const rows = await sql()`
    SELECT m.id, m.rule_id, m.message_log_id, m.formatted_text, m.forwarded_to,
           m.forward_errors, m.matched_at,
           l.message_text, l.sender_name, l.chat_id
    FROM message_rule_matches m
    LEFT JOIN messages_log l ON l.id = m.message_log_id
    WHERE m.rule_id = ${args.ruleId}
    ORDER BY m.matched_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    ruleId: Number(r.rule_id),
    messageLogId: Number(r.message_log_id),
    formattedText: (r.formatted_text as string) ?? null,
    forwardedTo: ((r.forwarded_to as unknown[]) ?? []).map((n) => Number(n)),
    matchedAt: r.matched_at as Date,
    messageText: (r.message_text as string) ?? "",
    senderName: (r.sender_name as string) ?? "?",
    chatId: r.chat_id != null ? Number(r.chat_id) : 0,
    forwardErrors:
      (r.forward_errors as Record<string, string> | null) ?? null,
  }));
}

export type RuleExample = {
  id: number;
  ruleId: number;
  text: string;
  label: string | null;
  createdAt: Date;
};

export async function listRuleExamples(ruleId: number): Promise<RuleExample[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, rule_id, text, label, created_at
    FROM message_rule_examples
    WHERE rule_id = ${ruleId}
    ORDER BY created_at ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    ruleId: Number(r.rule_id),
    text: r.text as string,
    label: (r.label as string) ?? null,
    createdAt: r.created_at as Date,
  }));
}

export async function addRuleExample(args: {
  ruleId: number;
  text: string;
  label?: string | null;
}): Promise<RuleExample> {
  if (!hasDb()) throw new Error("DATABASE_URL not set");
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO message_rule_examples (rule_id, text, label)
    VALUES (${args.ruleId}, ${args.text}, ${args.label ?? null})
    RETURNING id, rule_id, text, label, created_at`;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: Number(r.id),
    ruleId: Number(r.rule_id),
    text: r.text as string,
    label: (r.label as string) ?? null,
    createdAt: r.created_at as Date,
  };
}

export async function deleteRuleExample(exampleId: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM message_rule_examples WHERE id = ${exampleId}`;
}

// Cross-rule recent forwarded-match feed for /rules.
export async function listRecentRuleMatches(args: {
  limit: number;
  offset?: number;
}): Promise<
  Array<{
    id: number;
    ruleId: number;
    ruleName: string;
    messageLogId: number;
    formattedText: string | null;
    forwardedTo: number[];
    matchedAt: Date;
    messageText: string;
    senderName: string;
    chatId: number;
  }>
> {
  if (!hasDb()) return [];
  await ensureSchema();
  const n = Math.min(Math.max(args.limit, 1), 200);
  const offset = Math.max(args.offset ?? 0, 0);
  const rows = await sql()`
    SELECT m.id, m.rule_id, r.name AS rule_name,
           m.message_log_id, m.formatted_text, m.forwarded_to, m.matched_at,
           l.message_text, l.sender_name, l.chat_id
    FROM message_rule_matches m
    LEFT JOIN message_rules r ON r.id = m.rule_id
    LEFT JOIN messages_log l ON l.id = m.message_log_id
    ORDER BY m.matched_at DESC
    LIMIT ${n} OFFSET ${offset}`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    ruleId: Number(r.rule_id),
    ruleName: (r.rule_name as string) ?? "?",
    messageLogId: Number(r.message_log_id),
    formattedText: (r.formatted_text as string) ?? null,
    forwardedTo: ((r.forwarded_to as unknown[]) ?? []).map((n) => Number(n)),
    matchedAt: r.matched_at as Date,
    messageText: (r.message_text as string) ?? "",
    senderName: (r.sender_name as string) ?? "?",
    chatId: r.chat_id != null ? Number(r.chat_id) : 0,
  }));
}

// Rules where the given chat_id is a recipient. Used by /chats/[id]
// to show "this chat receives the following rules" and by the request-
// trigger lookback path in bot.ts.
export async function listRulesForRecipient(
  recipientChatId: number,
): Promise<MessageRule[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT r.id, r.tenant_id, r.name, r.description, r.forward_format,
           r.request_trigger, r.request_window_seconds,
           r.show_rule_prefix, r.format_as_otp, r.enabled,
           r.created_by, r.created_at, r.updated_at
    FROM message_rules r
    JOIN message_rule_recipients rr ON rr.rule_id = r.id
    WHERE rr.recipient_chat_id = ${recipientChatId}
    ORDER BY r.name ASC`;
  return (rows as Array<Record<string, unknown>>).map(rowToRule);
}

// Find rule-matches for a given recipient that haven't been forwarded
// to them yet AND fell within the request_window_seconds of now. Used
// when the recipient sends a "send me the code" trigger and we want to
// release the pending matches.
export async function findPendingMatchesForRecipient(args: {
  ruleId: number;
  recipientChatId: number;
  withinSeconds: number;
}): Promise<
  Array<{
    matchId: number;
    messageLogId: number;
    formattedText: string | null;
    messageText: string;
    senderName: string;
    chatId: number;
    matchedAt: Date;
  }>
> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT m.id AS match_id, m.message_log_id, m.formatted_text,
           m.matched_at, l.message_text, l.sender_name, l.chat_id
    FROM message_rule_matches m
    LEFT JOIN messages_log l ON l.id = m.message_log_id
    WHERE m.rule_id = ${args.ruleId}
      AND m.matched_at > NOW() - (${args.withinSeconds}::int || ' seconds')::interval
      AND NOT (${args.recipientChatId}::bigint = ANY(COALESCE(m.forwarded_to, ARRAY[]::bigint[])))
    ORDER BY m.matched_at ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    matchId: Number(r.match_id),
    messageLogId: Number(r.message_log_id),
    formattedText: (r.formatted_text as string) ?? null,
    messageText: (r.message_text as string) ?? "",
    senderName: (r.sender_name as string) ?? "?",
    chatId: r.chat_id != null ? Number(r.chat_id) : 0,
    matchedAt: r.matched_at as Date,
  }));
}

// Mark "the recipient just asked for the code" so later matches
// arriving inside the window can skip the gate.
export async function markRecipientRequestedNow(args: {
  ruleId: number;
  recipientChatId: number;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE message_rule_recipients
    SET last_request_at = NOW()
    WHERE rule_id = ${args.ruleId}
      AND recipient_chat_id = ${args.recipientChatId}`;
}

// True when the recipient sent a trigger within the last
// windowSeconds. Used by the FORWARD path to decide whether to skip
// the gate for this recipient on a freshly-arrived match.
export async function recipientRequestedRecently(args: {
  ruleId: number;
  recipientChatId: number;
  windowSeconds: number;
}): Promise<boolean> {
  if (!hasDb()) return false;
  await ensureSchema();
  const rows = await sql()`
    SELECT 1 FROM message_rule_recipients
    WHERE rule_id = ${args.ruleId}
      AND recipient_chat_id = ${args.recipientChatId}
      AND last_request_at IS NOT NULL
      AND last_request_at > NOW() - (${args.windowSeconds}::int || ' seconds')::interval
    LIMIT 1`;
  return rows.length > 0;
}

// Append a recipient chat_id to a match's forwarded_to array — used
// both on first forward and when releasing a held match later.
export async function markMatchForwardedTo(args: {
  matchId: number;
  recipientChatId: number;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE message_rule_matches
    SET forwarded_to = ARRAY(
      SELECT DISTINCT unnest(
        COALESCE(forwarded_to, ARRAY[]::bigint[]) || ARRAY[${args.recipientChatId}::bigint]
      )
    )
    WHERE id = ${args.matchId}`;
}

// Fetch recent messages for the "test this rule on history" action.
export async function listRecentMessagesForTest(
  limit: number,
): Promise<
  Array<{
    id: number;
    chatId: number;
    chatTitle: string | null;
    senderName: string;
    messageText: string;
    createdAt: Date;
  }>
> {
  if (!hasDb()) return [];
  await ensureSchema();
  const n = Math.min(Math.max(limit, 1), 200);
  const rows = await sql()`
    SELECT id, chat_id, chat_title, sender_name, message_text, created_at
    FROM messages_log
    WHERE from_owner = FALSE
      AND COALESCE(message_text, '') <> ''
    ORDER BY created_at DESC
    LIMIT ${n}`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    chatId: Number(r.chat_id),
    chatTitle: (r.chat_title as string) ?? null,
    senderName: (r.sender_name as string) ?? "?",
    messageText: (r.message_text as string) ?? "",
    createdAt: r.created_at as Date,
  }));
}

