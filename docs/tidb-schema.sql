-- TiDB/MySQL schema for tgsecretarybot — generated from ensureSchema
-- Run: mysql -h uk1.utoprop.org -P 4000 -u tgsecretary-bot -p tgsecretary-bot < tidb-schema.sql
SET FOREIGN_KEY_CHECKS=0;

CREATE TABLE IF NOT EXISTS business_connections (
        id            VARCHAR(255) PRIMARY KEY,
        user_id       BIGINT NOT NULL,
        user_chat_id  BIGINT NOT NULL,
        username      VARCHAR(255),
        first_name    TEXT,
        last_name     TEXT,
        can_reply     BOOLEAN NOT NULL DEFAULT FALSE,
        is_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE TABLE IF NOT EXISTS messages_log (
        id                     BIGINT AUTO_INCREMENT PRIMARY KEY,
        created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        business_connection_id VARCHAR(255) NOT NULL,
        owner_user_id          BIGINT,
        chat_id                BIGINT NOT NULL,
        chat_type              VARCHAR(255) NOT NULL,
        chat_title             TEXT,
        sender_id              BIGINT,
        sender_username        TEXT,
        sender_name            TEXT NOT NULL,
        message_id             BIGINT NOT NULL,
        message_text           TEXT NOT NULL,
        importance             INT NOT NULL DEFAULT 0,
        urgent                 BOOLEAN NOT NULL DEFAULT FALSE,
        concerns_owner         BOOLEAN NOT NULL DEFAULT FALSE,
        reason                 TEXT NOT NULL,
        alerted                BOOLEAN NOT NULL DEFAULT FALSE,
        auto_replied           BOOLEAN NOT NULL DEFAULT FALSE,
        handled_at             DATETIME,
        handled_by             BIGINT,
        notes                  TEXT
      );
CREATE INDEX IF NOT EXISTS messages_log_created_idx ON messages_log (created_at DESC);
CREATE INDEX IF NOT EXISTS messages_log_chat_idx ON messages_log (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_log_urgent_idx ON messages_log (urgent, created_at DESC);
ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS from_owner BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS skipped_reason TEXT;
ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS media_file_id TEXT;
ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS media_kind TEXT;
ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS transcript TEXT;
ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS transcript_at DATETIME;
ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS media_description TEXT;
ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS media_description_at DATETIME;
ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS deleted_at DATETIME;
CREATE INDEX IF NOT EXISTS messages_log_deleted_idx ON messages_log (deleted_at);
ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS edited_at DATETIME;
CREATE TABLE IF NOT EXISTS message_edits (
        id              BIGINT AUTO_INCREMENT PRIMARY KEY,
        message_log_id  BIGINT NOT NULL REFERENCES messages_log(id) ON DELETE CASCADE,
        previous_text   TEXT,
        previous_transcript TEXT,
        edited_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE INDEX IF NOT EXISTS message_edits_msg_idx ON message_edits (message_log_id, edited_at DESC);
ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS source VARCHAR(255);
CREATE INDEX IF NOT EXISTS messages_log_source_idx ON messages_log (source);
ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS inline_buttons JSON;
ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS message_thread_id BIGINT;
CREATE INDEX IF NOT EXISTS messages_log_thread_idx
      ON messages_log (chat_id, message_thread_id, created_at);
CREATE TABLE IF NOT EXISTS forum_topics (
        chat_id            BIGINT NOT NULL,
        message_thread_id  BIGINT NOT NULL,
        name               VARCHAR(255),
        icon_color         INT,
        icon_emoji         TEXT,
        is_closed          BOOLEAN NOT NULL DEFAULT FALSE,
        is_hidden          BOOLEAN NOT NULL DEFAULT FALSE,
        observed_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chat_id, message_thread_id)
      );
CREATE INDEX IF NOT EXISTS messages_log_owner_chat_idx ON messages_log (chat_id, created_at DESC);
ALTER TABLE `messages_log` MODIFY COLUMN `business_connection_id` VARCHAR(255) NULL;
ALTER TABLE `group_summaries` MODIFY COLUMN `business_connection_id` VARCHAR(255) NULL;
CREATE TABLE IF NOT EXISTS chat_rules (
        chat_id      BIGINT PRIMARY KEY,
        chat_type    VARCHAR(255) NOT NULL,
        chat_title   TEXT,
        vip          BOOLEAN NOT NULL DEFAULT FALSE,
        muted        BOOLEAN NOT NULL DEFAULT FALSE,
        custom_reply TEXT,
        notes        TEXT,
        updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE TABLE IF NOT EXISTS settings (
        `key`        VARCHAR(255) PRIMARY KEY,
        `value`      TEXT NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by BIGINT
      );
CREATE TABLE IF NOT EXISTS group_summaries (
        id                     BIGINT AUTO_INCREMENT PRIMARY KEY,
        chat_id                BIGINT NOT NULL,
        chat_title             TEXT,
        business_connection_id VARCHAR(255) NOT NULL,
        period_start           DATETIME NOT NULL,
        period_end             DATETIME NOT NULL,
        message_count          INT NOT NULL,
        active_senders         INT NOT NULL,
        summary                TEXT NOT NULL,
        topics                 JSON NOT NULL,
        action_items           JSON NOT NULL,
        mentions_owner         BOOLEAN NOT NULL DEFAULT FALSE,
        created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (chat_id, period_start)
      );
CREATE INDEX IF NOT EXISTS group_summaries_chat_idx ON group_summaries (chat_id, period_start DESC);
CREATE TABLE IF NOT EXISTS audit_log (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        actor_id    BIGINT,
        actor_name  TEXT,
        action      TEXT NOT NULL,
        target      TEXT,
        details     JSON
      );
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log (created_at DESC);
CREATE TABLE IF NOT EXISTS system_errors (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        level       VARCHAR(255) NOT NULL DEFAULT 'error',
        source      VARCHAR(255) NOT NULL,
        message     TEXT NOT NULL,
        stack       TEXT,
        scope       TEXT,
        details     JSON
      );
CREATE INDEX IF NOT EXISTS system_errors_created_idx ON system_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS system_errors_source_idx ON system_errors (source, created_at DESC);
CREATE INDEX IF NOT EXISTS system_errors_level_idx ON system_errors (level, created_at DESC);
CREATE TABLE IF NOT EXISTS secretary_sessions (
        id                     BIGINT AUTO_INCREMENT PRIMARY KEY,
        business_connection_id VARCHAR(255)    NOT NULL,
        sender_chat_id         BIGINT  NOT NULL,
        sender_name            TEXT,
        sender_username        TEXT,
        secretary_user_id      BIGINT  NOT NULL,
        secretary_chat_id      BIGINT  NOT NULL,
        header_message_id      BIGINT  NOT NULL,
        owner_user_id          BIGINT,
        created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_activity_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at               DATETIME,
        end_reason             TEXT
      );
CREATE INDEX IF NOT EXISTS secretary_sessions_active_idx
      ON secretary_sessions (business_connection_id, sender_chat_id);
CREATE TABLE IF NOT EXISTS secretary_message_links (
        id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
        session_id          BIGINT NOT NULL REFERENCES secretary_sessions(id) ON DELETE CASCADE,
        secretary_chat_id   BIGINT NOT NULL,
        secretary_message_id BIGINT NOT NULL,
        direction           VARCHAR(255)   NOT NULL,
        created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (secretary_chat_id, secretary_message_id)
      );
ALTER TABLE secretary_message_links ADD COLUMN IF NOT EXISTS sender_message_id BIGINT;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS mode VARCHAR(255) NOT NULL DEFAULT 'off';
ALTER TABLE chat_rules ALTER COLUMN mode SET DEFAULT 'off';
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS mode_changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS secretary_user_id BIGINT;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS relationship VARCHAR(255);
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS grace_skipped_at DATETIME;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS relationship_notes TEXT;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS talk_style_notes TEXT;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS tone_profile TEXT;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS tone_profile_at DATETIME;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS flood_cooldown_until DATETIME;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS flood_deflected_at DATETIME;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS ai_process_voice BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS ai_process_stickers BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS ai_process_gifs BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS ai_process_photos BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS ai_process_video_notes BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS ignored BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS phone_number TEXT;
CREATE TABLE IF NOT EXISTS sms_webhooks (
        id            BIGINT AUTO_INCREMENT PRIMARY KEY,
        name          VARCHAR(255) NOT NULL,
        secret        VARCHAR(255) NOT NULL UNIQUE,
        enabled       BOOLEAN NOT NULL DEFAULT TRUE,
        last_used_at  DATETIME,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE INDEX IF NOT EXISTS sms_webhooks_secret_idx ON sms_webhooks (secret);
ALTER TABLE sms_webhooks ADD COLUMN IF NOT EXISTS kind VARCHAR(255) NOT NULL DEFAULT 'sms';
ALTER TABLE sms_webhooks ADD COLUMN IF NOT EXISTS redact_private BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS is_private_conversation BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS private_revealed_at DATETIME;
ALTER TABLE forum_topics ADD COLUMN IF NOT EXISTS archived_at DATETIME;
ALTER TABLE forum_topics ADD COLUMN IF NOT EXISTS notes TEXT;
CREATE TABLE IF NOT EXISTS chat_members (
        chat_id                BIGINT NOT NULL,
        user_id                BIGINT NOT NULL,
        first_name             TEXT,
        last_name              TEXT,
        username               VARCHAR(255),
        is_bot                 BOOLEAN NOT NULL DEFAULT FALSE,
        is_premium             BOOLEAN NOT NULL DEFAULT FALSE,
        language_code          TEXT,
        `status`                 VARCHAR(255) NOT NULL DEFAULT 'member',
        first_seen_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_status_change_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chat_id, user_id)
      );
CREATE INDEX IF NOT EXISTS chat_members_chat_status_idx ON chat_members (chat_id, status);
CREATE TABLE IF NOT EXISTS site_monitors (
        id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
        name               VARCHAR(255) NOT NULL,
        login_url          TEXT NOT NULL,
        check_url          TEXT NOT NULL,
        username           VARCHAR(255),
        password           TEXT,
        username_field     VARCHAR(255) NOT NULL DEFAULT 'username',
        password_field     VARCHAR(255) NOT NULL DEFAULT 'password',
        extra_fields_json  TEXT,
        -- comma-separated Tehran-time hours to run at, e.g. '13,15'
        check_hours_tehran VARCHAR(255) NOT NULL DEFAULT '13,15',
        -- comma-separated weekday numbers to SKIP (0=Sun..6=Sat).
        -- Default skips Thursday(4) & Friday(5) per the operator.
        skip_weekdays      VARCHAR(255) NOT NULL DEFAULT '4,5',
        enabled            BOOLEAN NOT NULL DEFAULT TRUE,
        notify_on          VARCHAR(255) NOT NULL DEFAULT 'change',  -- 'change' | 'always' | 'nonempty'
        last_run_at        DATETIME,
        last_run_slot      TEXT,   -- 'YYYY-MM-DD:HH' Tehran, to dedupe per slot
        last_status        TEXT,   -- 'ok' | 'login_failed' | 'fetch_failed' | 'error'
        last_error         TEXT,
        last_content_hash  TEXT,
        last_content       TEXT,
        last_summary       TEXT,
        created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
ALTER TABLE site_monitors ADD COLUMN IF NOT EXISTS scrape_mode VARCHAR(255) NOT NULL DEFAULT 'http';
CREATE TABLE IF NOT EXISTS emails (
        id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
        direction          VARCHAR(255) NOT NULL,           -- 'in' | 'out'
        resend_id          TEXT,                    -- Resend message id (outgoing) or inbound id
        message_id         TEXT,                    -- RFC Message-ID header
        in_reply_to        TEXT,                    -- Message-ID this replies to
        thread_key         VARCHAR(255),                    -- for grouping (references / subject)
        from_email         TEXT,
        from_name          TEXT,
        to_emails          TEXT,                    -- comma-separated
        cc_emails          TEXT,
        subject            TEXT,
        text_body          TEXT,
        html_body          TEXT,
        summary            TEXT,                    -- AI summary (lazy)
        tg_chat_id         BIGINT,                  -- channel it was posted to
        tg_message_id      BIGINT,                  -- message id in that channel
        status             VARCHAR(255),                    -- outgoing: 'sent' | 'failed'
        error              TEXT,
        created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE INDEX IF NOT EXISTS emails_created_idx ON emails (created_at DESC);
CREATE INDEX IF NOT EXISTS emails_thread_idx ON emails (thread_key);
CREATE TABLE IF NOT EXISTS email_accounts (
        id              BIGINT AUTO_INCREMENT PRIMARY KEY,
        name            VARCHAR(255) NOT NULL,
        resend_api_key  TEXT,
        from_email      TEXT,
        inbound_token   VARCHAR(255) UNIQUE,
        tg_channel_id   BIGINT,
        enabled         BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
ALTER TABLE emails ADD COLUMN IF NOT EXISTS account_id BIGINT;
CREATE TABLE IF NOT EXISTS email_pending_replies (
        prompt_chat_id     BIGINT NOT NULL,
        prompt_message_id  BIGINT NOT NULL,
        email_id           BIGINT NOT NULL,
        created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (prompt_chat_id, prompt_message_id)
      );
CREATE TABLE IF NOT EXISTS sms_dedup (
        id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
        inbox_chat_id        BIGINT NOT NULL,
        body_signature       VARCHAR(255) NOT NULL,
        body_preview         TEXT,
        first_sent_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        repeat_count         INT NOT NULL DEFAULT 1,
        telegram_message_id  BIGINT,
        UNIQUE (inbox_chat_id, body_signature)
      );
CREATE INDEX IF NOT EXISTS sms_dedup_last_seen_idx
      ON sms_dedup (inbox_chat_id, last_seen_at DESC);
CREATE TABLE IF NOT EXISTS sms_block_rules (
        id            BIGINT AUTO_INCREMENT PRIMARY KEY,
        example_body  TEXT NOT NULL,
        label         VARCHAR(255),
        enabled       BOOLEAN NOT NULL DEFAULT TRUE,
        hit_count     INT NOT NULL DEFAULT 0,
        last_hit_at   DATETIME,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by    BIGINT
      );
CREATE INDEX IF NOT EXISTS sms_block_rules_enabled_idx
      ON sms_block_rules (enabled);
CREATE TABLE IF NOT EXISTS sms_accept_signatures (
        id              BIGINT AUTO_INCREMENT PRIMARY KEY,
        body_signature  VARCHAR(255) NOT NULL UNIQUE,
        body_preview    TEXT,
        hit_count       INT NOT NULL DEFAULT 0,
        last_hit_at     DATETIME,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by      BIGINT
      );
CREATE INDEX IF NOT EXISTS sms_accept_signatures_sig_idx
      ON sms_accept_signatures (body_signature);
CREATE TABLE IF NOT EXISTS secretary_relays (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        enabled     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE TABLE IF NOT EXISTS secretary_relay_sources (
        relay_id        BIGINT NOT NULL REFERENCES secretary_relays(id) ON DELETE CASCADE,
        source_chat_id  BIGINT NOT NULL,
        source_label    TEXT,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (relay_id, source_chat_id)
      );
CREATE INDEX IF NOT EXISTS secretary_relay_sources_chat_idx
      ON secretary_relay_sources (source_chat_id);
CREATE TABLE IF NOT EXISTS secretary_relay_recipients (
        relay_id          BIGINT NOT NULL REFERENCES secretary_relays(id) ON DELETE CASCADE,
        recipient_chat_id BIGINT NOT NULL,
        recipient_label   TEXT,
        created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (relay_id, recipient_chat_id)
      );
CREATE INDEX IF NOT EXISTS secretary_relay_recipients_chat_idx
      ON secretary_relay_recipients (recipient_chat_id);
CREATE TABLE IF NOT EXISTS secretary_relay_links (
        id                     BIGINT AUTO_INCREMENT PRIMARY KEY,
        relay_id               BIGINT REFERENCES secretary_relays(id) ON DELETE SET NULL,
        business_connection_id VARCHAR(255),
        source_chat_id         BIGINT NOT NULL,
        source_message_id      BIGINT,
        recipient_chat_id      BIGINT NOT NULL,
        recipient_message_id   BIGINT NOT NULL,
        direction              VARCHAR(255)   NOT NULL,
        created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (recipient_chat_id, recipient_message_id)
      );
CREATE INDEX IF NOT EXISTS secretary_relay_links_source_idx
      ON secretary_relay_links (source_chat_id, source_message_id);
CREATE TABLE IF NOT EXISTS note_watch_items (
        id              BIGINT AUTO_INCREMENT PRIMARY KEY,
        concept         VARCHAR(255) NOT NULL,
        description     TEXT,
        enabled         BOOLEAN NOT NULL DEFAULT TRUE,
        match_count     INT NOT NULL DEFAULT 0,
        last_matched_at DATETIME,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE TABLE IF NOT EXISTS note_watch_matches (
        id              BIGINT AUTO_INCREMENT PRIMARY KEY,
        item_id         BIGINT NOT NULL REFERENCES note_watch_items(id) ON DELETE CASCADE,
        chat_id         BIGINT NOT NULL,
        chat_title      TEXT,
        message_log_id  BIGINT,
        source_message_id BIGINT,
        sender_name     TEXT,
        quote           TEXT NOT NULL,
        reason          TEXT,
        forwarded_to    BIGINT,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE INDEX IF NOT EXISTS note_watch_matches_item_idx
      ON note_watch_matches (item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS note_watch_matches_chat_idx
      ON note_watch_matches (chat_id, created_at DESC);
ALTER TABLE note_watch_matches ADD COLUMN IF NOT EXISTS reported_wrong_at DATETIME;
ALTER TABLE note_watch_matches ADD COLUMN IF NOT EXISTS confirmed_at DATETIME;
CREATE TABLE IF NOT EXISTS note_watch_aliases (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        item_id     BIGINT NOT NULL REFERENCES note_watch_items(id) ON DELETE CASCADE,
        alias       VARCHAR(255) NOT NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (item_id, alias)
      );
CREATE INDEX IF NOT EXISTS note_watch_aliases_item_idx
      ON note_watch_aliases (item_id);
ALTER TABLE note_watch_items ADD COLUMN IF NOT EXISTS emoji TEXT;
ALTER TABLE note_watch_items ADD COLUMN IF NOT EXISTS priority VARCHAR(255) NOT NULL DEFAULT 'normal';
ALTER TABLE note_watch_items ADD COLUMN IF NOT EXISTS forward_to_inbox BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE note_watch_items ADD COLUMN IF NOT EXISTS cooldown_override_minutes INT;
ALTER TABLE note_watch_items ADD COLUMN IF NOT EXISTS context TEXT;
CREATE TABLE IF NOT EXISTS group_analytics (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        chat_id     BIGINT NOT NULL,
        chat_title  TEXT,
        window_days INT NOT NULL,
        since_iso   TEXT NOT NULL,
        message_count INT NOT NULL,
        analysis    JSON NOT NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (chat_id, window_days)
      );
CREATE INDEX IF NOT EXISTS group_analytics_chat_idx
      ON group_analytics (chat_id, created_at DESC);
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS analytics_share_token VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS chat_rules_share_token_idx
      ON chat_rules (analytics_share_token);
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS summary_interval_hours INT;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS last_summary_run_at DATETIME;
ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS otp_code TEXT;
CREATE TABLE IF NOT EXISTS phone_contacts (
        id                BIGINT AUTO_INCREMENT PRIMARY KEY,
        phone_full        TEXT NOT NULL,
        phone_tail        VARCHAR(255) NOT NULL,
        telegram_user_id  BIGINT,
        first_name        TEXT,
        last_name         TEXT,
        username          VARCHAR(255),
        source            VARCHAR(255) NOT NULL DEFAULT 'contact_share',
        observed_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE INDEX IF NOT EXISTS phone_contacts_tail_idx ON phone_contacts (phone_tail);
CREATE INDEX IF NOT EXISTS phone_contacts_user_idx ON phone_contacts (telegram_user_id);
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS ai_generate_photo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS function_role VARCHAR(255);
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS function_config JSON;
CREATE INDEX IF NOT EXISTS chat_rules_function_role_idx ON chat_rules (function_role);
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS auto_summarize_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS auto_summarize_gap_minutes INT NOT NULL DEFAULT 5;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS auto_summarize_smart_timing BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS last_auto_summary_at DATETIME;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS auto_forward_voice BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS auto_forward_video BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS auto_forward_photo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS auto_forward_location BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS auto_extract_notes BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_threshold_hours NUMERIC NOT NULL DEFAULT 2;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_escalate_hours NUMERIC NOT NULL DEFAULT 12;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_last_ping_at DATETIME;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_last_ping_kind TEXT;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_acked_at DATETIME;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_ai_for_message_at DATETIME;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_ai_verdict_at DATETIME;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_ai_needs_reply BOOLEAN;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_ai_reason TEXT;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_ai_urgency TEXT;
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS follow_up_transcribe_voices BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS chat_profiles (
        id                          INT AUTO_INCREMENT PRIMARY KEY,
        slug                        VARCHAR(255) NOT NULL,
        name                        VARCHAR(255) NOT NULL,
        emoji                       TEXT,
        description                 TEXT,
        is_default                  BOOLEAN NOT NULL DEFAULT FALSE,
        is_builtin                  BOOLEAN NOT NULL DEFAULT FALSE,
        follow_up_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
        follow_up_threshold_hours   NUMERIC NOT NULL DEFAULT 2,
        follow_up_escalate_hours    NUMERIC NOT NULL DEFAULT 12,
        follow_up_transcribe_voices BOOLEAN NOT NULL DEFAULT FALSE,
        tenant_id                   BIGINT,
        created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id, slug)
      );
ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS profile_id INTEGER;
CREATE INDEX IF NOT EXISTS chat_rules_profile_idx
      ON chat_rules (profile_id);
ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS mode VARCHAR(255);
ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS vip BOOLEAN;
ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS muted BOOLEAN;
ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS auto_summarize_enabled BOOLEAN;
ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS auto_summarize_gap_minutes INTEGER;
ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS auto_summarize_smart_timing BOOLEAN;
ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS auto_forward_voice BOOLEAN;
ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS auto_forward_video BOOLEAN;
ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS auto_forward_photo BOOLEAN;
ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS auto_forward_location BOOLEAN;
ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS auto_extract_notes BOOLEAN;
ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS ai_process_voice BOOLEAN;
ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS ai_process_stickers BOOLEAN;
ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS ai_process_gifs BOOLEAN;
ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS ai_process_photos BOOLEAN;
ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS ai_process_video_notes BOOLEAN;
CREATE TABLE IF NOT EXISTS owner_reactions (
        id                     BIGINT AUTO_INCREMENT PRIMARY KEY,
        chat_id                BIGINT NOT NULL,
        business_connection_id VARCHAR(255),
        message_id             BIGINT NOT NULL,
        emojis                 TEXT,
        tenant_id              BIGINT,
        reacted_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE UNIQUE INDEX IF NOT EXISTS owner_reactions_unique_idx
      ON owner_reactions (chat_id, COALESCE(business_connection_id, ''), message_id);
CREATE INDEX IF NOT EXISTS owner_reactions_chat_time_idx
      ON owner_reactions (chat_id, reacted_at DESC);
CREATE TABLE IF NOT EXISTS chat_function_roles (
        chat_id     BIGINT NOT NULL,
        role        VARCHAR(255) NOT NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chat_id, role)
      );
CREATE TABLE IF NOT EXISTS telegram_debug_log (
        id           BIGINT AUTO_INCREMENT PRIMARY KEY,
        received_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        update_type  VARCHAR(255) NOT NULL,
        chat_id      BIGINT,
        chat_type    VARCHAR(255),
        user_id      BIGINT,
        bc_id        TEXT,
        preview      TEXT,
        payload      JSON NOT NULL
      );
CREATE INDEX IF NOT EXISTS telegram_debug_log_received_idx
      ON telegram_debug_log (received_at DESC);
CREATE INDEX IF NOT EXISTS chat_function_roles_role_idx ON chat_function_roles (role);
ALTER TABLE chat_function_roles ADD COLUMN IF NOT EXISTS category TEXT;
CREATE TABLE IF NOT EXISTS function_categories (
        slug        VARCHAR(255) PRIMARY KEY,
        label       VARCHAR(255) NOT NULL,
        emoji       TEXT,
        sort_order  INT NOT NULL DEFAULT 100,
        is_builtin  BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE TABLE IF NOT EXISTS chat_notes (
        id                BIGINT AUTO_INCREMENT PRIMARY KEY,
        chat_id           BIGINT NOT NULL,
        tenant_id         BIGINT,
        source_message_id BIGINT,
        kind              VARCHAR(255) NOT NULL,
        title             TEXT,
        content           TEXT NOT NULL,
        metadata          JSON,
        sender_name       TEXT,
        archived_at       DATETIME,
        created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE INDEX IF NOT EXISTS chat_notes_chat_idx ON chat_notes (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_notes_tenant_idx ON chat_notes (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_notes_kind_idx ON chat_notes (kind, created_at DESC);
CREATE TABLE IF NOT EXISTS media_router_messages (
        storage_chat_id    BIGINT NOT NULL,
        storage_message_id BIGINT NOT NULL,
        file_id            TEXT NOT NULL,
        kind               VARCHAR(255) NOT NULL,
        source_chat_id     BIGINT,
        source_message_id  BIGINT,
        source_sender_name TEXT,
        tenant_id          BIGINT,
        transcript         TEXT,
        transcribed_at     DATETIME,
        created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (storage_chat_id, storage_message_id)
      );
CREATE INDEX IF NOT EXISTS media_router_messages_source_idx ON media_router_messages (source_chat_id, source_message_id);
CREATE TABLE IF NOT EXISTS media_routing_log (
        id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
        source_chat_id     BIGINT NOT NULL,
        source_message_id  BIGINT,
        kind               VARCHAR(255) NOT NULL,
        decision           TEXT NOT NULL,
        target_role        TEXT,
        target_chat_id     BIGINT,
        target_message_id  BIGINT,
        error              TEXT,
        created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE INDEX IF NOT EXISTS media_routing_log_created_idx ON media_routing_log (created_at DESC);
CREATE INDEX IF NOT EXISTS media_routing_log_source_idx ON media_routing_log (source_chat_id, created_at DESC);
CREATE TABLE IF NOT EXISTS thread_summaries (
        id                BIGINT AUTO_INCREMENT PRIMARY KEY,
        chat_id           BIGINT NOT NULL,
        thread_started_at DATETIME NOT NULL,
        thread_ended_at   DATETIME NOT NULL,
        message_count     INT NOT NULL,
        summary           TEXT NOT NULL,
        topics            JSON NOT NULL,
        action_items      JSON NOT NULL,
        created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (chat_id, thread_started_at)
      );
CREATE INDEX IF NOT EXISTS thread_summaries_chat_idx ON thread_summaries (chat_id, thread_started_at DESC);
ALTER TABLE thread_summaries ADD COLUMN IF NOT EXISTS inbox_chat_id BIGINT;
ALTER TABLE thread_summaries ADD COLUMN IF NOT EXISTS inbox_message_id BIGINT;
CREATE INDEX IF NOT EXISTS thread_summaries_inbox_idx ON thread_summaries (inbox_chat_id, inbox_message_id);
CREATE TABLE IF NOT EXISTS ask_queries (
        id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
        prompt             TEXT NOT NULL,
        prompt_hash        VARCHAR(255) NOT NULL,
        answer             TEXT NOT NULL,
        scanned_messages   INT NOT NULL,
        days               INT NOT NULL,
        created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by         BIGINT
      );
CREATE INDEX IF NOT EXISTS ask_queries_created_idx ON ask_queries (created_at DESC);
CREATE INDEX IF NOT EXISTS ask_queries_hash_idx ON ask_queries (prompt_hash, created_at DESC);
CREATE TABLE IF NOT EXISTS monitored_accounts (
        id              BIGINT AUTO_INCREMENT PRIMARY KEY,
        platform        VARCHAR(255) NOT NULL DEFAULT 'instagram',
        username        VARCHAR(255) NOT NULL,
        url             TEXT,
        external_id     VARCHAR(255),
        topic_id        TEXT,
        enabled         BOOLEAN NOT NULL DEFAULT TRUE,
        last_checked_at DATETIME,
        last_story_at   DATETIME,
        last_error      TEXT,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (platform, username)
      );
CREATE INDEX IF NOT EXISTS monitored_accounts_enabled_idx ON monitored_accounts (enabled, last_checked_at NULLS FIRST);
ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS check_stories BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS check_posts BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS check_reels BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS check_profile BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS check_mentioned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS interval_minutes INT NOT NULL DEFAULT 30;
ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS instagram_user_id TEXT;
ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS last_media_count INT;
ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS mode VARCHAR(255) NOT NULL DEFAULT 'interval';
ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS last_notify_at DATETIME;
ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS pending_fetch_at DATETIME;
ALTER TABLE monitored_accounts ADD COLUMN IF NOT EXISTS pending_notify_kinds JSON;
CREATE INDEX IF NOT EXISTS monitored_accounts_pending_idx
      ON monitored_accounts (pending_fetch_at);
ALTER TABLE monitor_events ADD COLUMN IF NOT EXISTS kind VARCHAR(255) NOT NULL DEFAULT 'story';
ALTER TABLE monitor_events ADD COLUMN IF NOT EXISTS caption TEXT;
ALTER TABLE monitor_events ADD COLUMN IF NOT EXISTS media_type TEXT;
CREATE TABLE IF NOT EXISTS monitor_events (
        id              BIGINT AUTO_INCREMENT PRIMARY KEY,
        account_id      BIGINT NOT NULL REFERENCES monitored_accounts(id) ON DELETE CASCADE,
        story_id        VARCHAR(255),
        story_url       TEXT,
        detected_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        forwarded_chat_id BIGINT,
        forwarded_message_id BIGINT,
        forwarded_at    DATETIME,
        `status`          VARCHAR(255) NOT NULL DEFAULT 'detected',
        error           TEXT,
        UNIQUE (account_id, story_id)
      );
CREATE INDEX IF NOT EXISTS monitor_events_account_idx ON monitor_events (account_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS monitor_events_detected_idx ON monitor_events (detected_at DESC);
CREATE TABLE IF NOT EXISTS ai_usage (
        id                     BIGINT AUTO_INCREMENT PRIMARY KEY,
        created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        chat_id                BIGINT,
        business_connection_id VARCHAR(255),
        model                  TEXT NOT NULL,
        purpose                VARCHAR(255) NOT NULL,
        prompt_tokens          INT NOT NULL DEFAULT 0,
        completion_tokens      INT NOT NULL DEFAULT 0,
        total_tokens           INT NOT NULL DEFAULT 0,
        cost_usd               NUMERIC(12, 6) NOT NULL DEFAULT 0
      );
CREATE INDEX IF NOT EXISTS ai_usage_chat_idx ON ai_usage (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage (created_at DESC);
CREATE TABLE IF NOT EXISTS hikerapi_usage (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        called_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        endpoint    TEXT NOT NULL,
        cost_usd    NUMERIC(10, 6) NOT NULL DEFAULT 0,
        account_id  BIGINT
      );
CREATE INDEX IF NOT EXISTS hikerapi_usage_called_idx ON hikerapi_usage (called_at DESC);
CREATE INDEX IF NOT EXISTS hikerapi_usage_account_idx ON hikerapi_usage (account_id, called_at DESC);
CREATE TABLE IF NOT EXISTS extracted_items (
        id           BIGINT AUTO_INCREMENT PRIMARY KEY,
        message_id   BIGINT,
        chat_id      BIGINT,
        chat_title   TEXT,
        sender_name  TEXT,
        kind         VARCHAR(255) NOT NULL,
        title        TEXT NOT NULL,
        description  TEXT,
        due_at       DATETIME,
        location     TEXT,
        participants JSON,
        done_at      DATETIME,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE INDEX IF NOT EXISTS extracted_items_due_idx ON extracted_items (due_at);
CREATE INDEX IF NOT EXISTS extracted_items_created_idx ON extracted_items (created_at DESC);
ALTER TABLE extracted_items ADD COLUMN IF NOT EXISTS source_text TEXT;
ALTER TABLE extracted_items ADD COLUMN IF NOT EXISTS tg_message_id BIGINT;
ALTER TABLE extracted_items ADD COLUMN IF NOT EXISTS priority VARCHAR(255) NOT NULL DEFAULT 'normal';
CREATE INDEX IF NOT EXISTS extracted_items_priority_idx ON extracted_items (priority, created_at DESC);
CREATE TABLE IF NOT EXISTS invites (
        token        VARCHAR(255) PRIMARY KEY,
        purpose      VARCHAR(255) NOT NULL,
        payload      JSON NOT NULL,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at   DATETIME NOT NULL,
        used_at      DATETIME,
        used_by      BIGINT,
        created_by   BIGINT
      );
CREATE INDEX IF NOT EXISTS invites_expires_idx ON invites (expires_at);
CREATE TABLE IF NOT EXISTS knowledge_entries (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        title       TEXT NOT NULL,
        aliases     JSON NOT NULL,
        body        TEXT NOT NULL,
        tags        JSON NOT NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by  BIGINT
      );
CREATE INDEX IF NOT EXISTS knowledge_entries_title_idx ON knowledge_entries (lower(title));
CREATE INDEX IF NOT EXISTS knowledge_entries_updated_idx ON knowledge_entries (updated_at DESC);
CREATE TABLE IF NOT EXISTS processed_updates (
        update_id    BIGINT PRIMARY KEY,
        processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE INDEX IF NOT EXISTS processed_updates_at_idx ON processed_updates (processed_at);
ALTER TABLE processed_updates ADD COLUMN IF NOT EXISTS update_type VARCHAR(255);
ALTER TABLE processed_updates ADD COLUMN IF NOT EXISTS chat_id BIGINT;
ALTER TABLE processed_updates ADD COLUMN IF NOT EXISTS preview TEXT;
CREATE INDEX IF NOT EXISTS processed_updates_type_idx ON processed_updates (update_type, processed_at DESC);
CREATE TABLE IF NOT EXISTS tenants (
        id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
        name                    VARCHAR(255) NOT NULL UNIQUE,
        plan                    VARCHAR(255) NOT NULL DEFAULT 'starter',
        hiker_budget_usd        NUMERIC(10, 2) NOT NULL DEFAULT 50,
        hiker_approved_usd      NUMERIC(10, 2) NOT NULL DEFAULT 10,
        hiker_approval_step_usd NUMERIC(10, 2) NOT NULL DEFAULT 10,
        monitored_cap           INT NOT NULL DEFAULT 50,
        is_enabled              BOOLEAN NOT NULL DEFAULT TRUE,
        notes                   TEXT,
        created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS hiker_api_key TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS hiker_api_key_name TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS openrouter_api_key TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS groq_api_key TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS openrouter_budget_usd        NUMERIC(10, 2) NOT NULL DEFAULT 20;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS openrouter_approved_usd      NUMERIC(10, 2) NOT NULL DEFAULT 5;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS openrouter_approval_step_usd NUMERIC(10, 2) NOT NULL DEFAULT 5;
CREATE TABLE IF NOT EXISTS tenant_settings (
        tenant_id  BIGINT NOT NULL,
        `key`        VARCHAR(255) NOT NULL,
        `value`      TEXT NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by BIGINT,
        PRIMARY KEY (tenant_id, `key`)
      );
CREATE INDEX IF NOT EXISTS tenant_settings_tenant_idx ON tenant_settings (tenant_id);
CREATE TABLE IF NOT EXISTS owner_assets (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        kind        VARCHAR(255) NOT NULL,
        tenant_id   BIGINT,
        mime        TEXT NOT NULL,
        data        BYTEA NOT NULL,
        updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE UNIQUE INDEX IF NOT EXISTS owner_assets_kind_tenant_uniq ON owner_assets (kind, COALESCE(tenant_id, 0));
CREATE TABLE IF NOT EXISTS message_rules (
        id              BIGINT AUTO_INCREMENT PRIMARY KEY,
        tenant_id       BIGINT,
        name            VARCHAR(255) NOT NULL,
        description     TEXT NOT NULL,
        forward_format  TEXT,
        enabled         BOOLEAN NOT NULL DEFAULT TRUE,
        created_by      BIGINT,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE INDEX IF NOT EXISTS message_rules_tenant_idx ON message_rules (tenant_id);
CREATE INDEX IF NOT EXISTS message_rules_enabled_idx ON message_rules (enabled);
CREATE TABLE IF NOT EXISTS message_rule_recipients (
        rule_id          BIGINT NOT NULL,
        recipient_chat_id BIGINT NOT NULL,
        recipient_label  TEXT,
        created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (rule_id, recipient_chat_id)
      );
CREATE INDEX IF NOT EXISTS message_rule_recipients_chat_idx ON message_rule_recipients (recipient_chat_id);
CREATE TABLE IF NOT EXISTS message_rule_matches (
        id              BIGINT AUTO_INCREMENT PRIMARY KEY,
        rule_id         BIGINT NOT NULL,
        message_log_id  BIGINT NOT NULL,
        formatted_text  TEXT,
        forwarded_to    BIGINT[],
        matched_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE INDEX IF NOT EXISTS message_rule_matches_rule_idx ON message_rule_matches (rule_id, matched_at DESC);
CREATE INDEX IF NOT EXISTS message_rule_matches_message_idx ON message_rule_matches (message_log_id);
ALTER TABLE message_rule_matches ADD COLUMN IF NOT EXISTS forward_errors JSON;
CREATE TABLE IF NOT EXISTS message_rule_examples (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        rule_id     BIGINT NOT NULL,
        text        TEXT NOT NULL,
        label       VARCHAR(255),
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
CREATE INDEX IF NOT EXISTS message_rule_examples_rule_idx ON message_rule_examples (rule_id);
ALTER TABLE message_rule_examples
      ADD COLUMN IF NOT EXISTS purpose VARCHAR(255) NOT NULL DEFAULT 'rule_match';
CREATE INDEX IF NOT EXISTS message_rule_examples_purpose_idx
      ON message_rule_examples (rule_id, purpose);
ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS request_trigger TEXT;
ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS request_window_seconds INT;
ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS show_rule_prefix BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS format_as_otp BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE message_rule_recipients ADD COLUMN IF NOT EXISTS last_request_at DATETIME;
CREATE TABLE IF NOT EXISTS monitor_subscriptions (
        username          VARCHAR(255) PRIMARY KEY,
        registered_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        unregistered_at   DATETIME,
        last_pushed_at    DATETIME,
        last_status       INT,
        last_notified_at  DATETIME,
        notify_count      INT NOT NULL DEFAULT 0
      );
CREATE INDEX IF NOT EXISTS monitor_subscriptions_active_idx ON monitor_subscriptions (registered_at DESC);
CREATE TABLE IF NOT EXISTS admin_users (
        user_id    BIGINT PRIMARY KEY,
        username   VARCHAR(255),
        first_name TEXT,
        added_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        added_by   BIGINT
      );
ALTER TABLE business_connections ADD COLUMN IF NOT EXISTS tenant_id BIGINT REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE messages_log         ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
ALTER TABLE chat_rules           ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
ALTER TABLE monitored_accounts   ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
ALTER TABLE monitor_events       ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
ALTER TABLE hikerapi_usage       ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
ALTER TABLE ai_usage             ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
ALTER TABLE thread_summaries     ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
ALTER TABLE extracted_items      ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
ALTER TABLE audit_log            ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
ALTER TABLE ask_queries          ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
CREATE INDEX IF NOT EXISTS business_connections_tenant_idx ON business_connections (tenant_id);
CREATE INDEX IF NOT EXISTS messages_log_tenant_idx ON messages_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_rules_tenant_idx ON chat_rules (tenant_id);
CREATE INDEX IF NOT EXISTS monitored_accounts_tenant_idx ON monitored_accounts (tenant_id);
CREATE INDEX IF NOT EXISTS monitor_events_tenant_idx ON monitor_events (tenant_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS hikerapi_usage_tenant_idx ON hikerapi_usage (tenant_id, called_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_tenant_idx ON ai_usage (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS thread_summaries_tenant_idx ON thread_summaries (tenant_id);

SET FOREIGN_KEY_CHECKS=1;
