// Forward-only schema migrations, tracked in schema_migrations.
//
// ensureSchema() in core.ts is ~240 idempotent CREATE/ALTER statements
// guarded by a single SCHEMA_VERSION string: forget to bump the string
// and the new DDL silently never runs. That happened twice in one week.
//
// New schema changes go HERE instead. Each migration has a stable id and
// runs exactly once, in order, whether or not SCHEMA_VERSION changed —
// the runner is invoked on both the fast path and the full path. The
// existing ensureSchema DDL is left in place: it is idempotent, proven
// against the live database, and rewriting it would be pure risk.
//
// Rules:
//   * ids sort lexically → use YYYY-MM-DD-NNN-short-name
//   * a migration must be safe to run against production data
//   * never edit a migration that has shipped; add a new one
//   * keep ensureSchema's DDL list closed — additions go in MIGRATIONS

import type { NeonQueryFunction } from "@neondatabase/serverless";
import { reportError } from "../report";

type Q = NeonQueryFunction<false, false>;

export type Migration = {
  id: string;
  up: (q: Q) => Promise<void>;
};

export const MIGRATIONS: Migration[] = [
  {
    // A scoped token could write to exactly one chat, and only inside
    // one topic of it. The DevOps agent needs full write in a second
    // group while keeping the topic-confined write in the first, so
    // write_chat_ids lists chats it may post to in any topic.
    id: "2026-09-05-001-mcp-write-chat-ids",
    up: async (q) => {
      await q`ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS write_chat_ids TEXT`;
    },
  },
  {
    // Self-deleting messages: what the bot sent and when to delete it.
    // See lib/db/ephemeral.ts.
    id: "2026-09-13-001-ephemeral-messages",
    up: async (q) => {
      await q`
        CREATE TABLE IF NOT EXISTS ephemeral_messages (
          id          BIGSERIAL PRIMARY KEY,
          chat_id     BIGINT NOT NULL,
          message_id  BIGINT NOT NULL,
          delete_at   TIMESTAMPTZ NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          deleted_at  TIMESTAMPTZ,
          attempts    INT NOT NULL DEFAULT 0,
          last_error  TEXT,
          label       TEXT
        )`;
      await q`
        CREATE INDEX IF NOT EXISTS ephemeral_messages_due_idx
          ON ephemeral_messages (delete_at) WHERE deleted_at IS NULL`;
    },
  },
  {
    // Continuous-improvement program: one metrics snapshot per day and
    // the backlog of features / fixes / improvements. See lib/metrics.ts
    // and lib/db/roadmap.ts.
    id: "2026-09-15-001-metrics-and-roadmap",
    up: async (q) => {
      await q`
        CREATE TABLE IF NOT EXISTS system_metrics_daily (
          day          DATE PRIMARY KEY,
          metrics      JSONB NOT NULL,
          computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      await q`
        CREATE TABLE IF NOT EXISTS improvement_items (
          id          BIGSERIAL PRIMARY KEY,
          kind        TEXT NOT NULL DEFAULT 'improvement',
          title       TEXT NOT NULL,
          details     TEXT,
          priority    INT NOT NULL DEFAULT 2,
          status      TEXT NOT NULL DEFAULT 'idea',
          source      TEXT NOT NULL DEFAULT 'owner',
          planned_for DATE,
          commit_sha  TEXT,
          outcome     TEXT,
          created_by  TEXT,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          done_at     TIMESTAMPTZ
        )`;
      await q`
        CREATE INDEX IF NOT EXISTS improvement_items_status_idx
          ON improvement_items (status, priority, planned_for)`;
    },
  },
  {
    // SMS feedback generalisation: remember who sent an accepted /
    // deduped SMS so "same sender, similar wording" can be scored.
    id: "2026-09-18-001-sms-sender-columns",
    up: async (q) => {
      await q`ALTER TABLE sms_dedup ADD COLUMN IF NOT EXISTS sender TEXT`;
      await q`ALTER TABLE sms_accept_signatures ADD COLUMN IF NOT EXISTS sender TEXT`;
    },
  },
  {
    // Whose phone an SMS came through (the webhook label, e.g. "پیامک
    // مرضیه") so the OTP board can say "from Marzieh" next to a code.
    id: "2026-09-23-001-sms-dedup-source-label",
    up: async (q) => {
      await q`ALTER TABLE sms_dedup ADD COLUMN IF NOT EXISTS source_label TEXT`;
    },
  },
  {
    // A rule with no source allowlist ("any source") still needs a way
    // to keep specific chats out — a bot that posts customer support
    // tickets must not be swept up by the status-ticket rule.
    id: "2026-10-01-001-rules-exclude-sources",
    up: async (q) => {
      await q`ALTER TABLE message_rules ADD COLUMN IF NOT EXISTS exclude_source_chat_ids TEXT`;
    },
  },
  {
    // Link-download relay: the "⏳ downloading" placeholder and the cover
    // card sent to the contact before the file arrives, so they can be
    // replaced / captioned when it does.
    id: "2026-10-01-002-link-jobs-progress",
    up: async (q) => {
      await q`ALTER TABLE link_download_jobs ADD COLUMN IF NOT EXISTS placeholder_message_id BIGINT`;
      await q`ALTER TABLE link_download_jobs ADD COLUMN IF NOT EXISTS cover_message_id BIGINT`;
      await q`ALTER TABLE link_download_jobs ADD COLUMN IF NOT EXISTS title TEXT`;
    },
  },
  {
    // Personal music library (/music): tracks fetched through the paid
    // Spotify downloader bot and stored on this server for the owner.
    id: "2026-10-05-001-music-library",
    up: async (q) => {
      await q`
        CREATE TABLE IF NOT EXISTS music_tracks (
          id            BIGSERIAL PRIMARY KEY,
          spotify_id    TEXT UNIQUE,
          spotify_url   TEXT NOT NULL,
          title         TEXT,
          artist        TEXT,
          album         TEXT,
          release_date  TEXT,
          duration_s    INT,
          file_path     TEXT,
          cover_path    TEXT,
          mime          TEXT,
          size_bytes    BIGINT,
          status        TEXT NOT NULL DEFAULT 'queued',
          error         TEXT,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ready_at      TIMESTAMPTZ
        )`;
      await q`CREATE INDEX IF NOT EXISTS music_tracks_status_idx ON music_tracks (status, created_at)`;
      await q`
        CREATE TABLE IF NOT EXISTS music_playlists (
          id         BIGSERIAL PRIMARY KEY,
          name       TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      await q`
        CREATE TABLE IF NOT EXISTS music_playlist_tracks (
          playlist_id BIGINT NOT NULL REFERENCES music_playlists(id) ON DELETE CASCADE,
          track_id    BIGINT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
          position    INT NOT NULL DEFAULT 0,
          PRIMARY KEY (playlist_id, track_id)
        )`;
      await q`ALTER TABLE link_download_jobs ADD COLUMN IF NOT EXISTS music_track_id BIGINT`;
    },
  },
  {
    // Several Spotify accounts can stay linked to the music library.
    id: "2026-10-05-002-spotify-accounts",
    up: async (q) => {
      await q`
        CREATE TABLE IF NOT EXISTS spotify_accounts (
          id               BIGSERIAL PRIMARY KEY,
          spotify_user_id  TEXT NOT NULL UNIQUE,
          display_name     TEXT,
          refresh_token    TEXT NOT NULL,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
    },
  },
  {
    // Like / dislike and play stats for the smart mix in /music.
    id: "2026-10-06-001-music-ratings",
    up: async (q) => {
      await q`ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS rating INT NOT NULL DEFAULT 0`;
      await q`ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS play_count INT NOT NULL DEFAULT 0`;
      await q`ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS skip_count INT NOT NULL DEFAULT 0`;
      await q`ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS last_played_at TIMESTAMPTZ`;
    },
  },
  {
    // Listening log for the music analytics (seconds actually heard).
    id: "2026-10-06-002-music-events",
    up: async (q) => {
      await q`
        CREATE TABLE IF NOT EXISTS music_events (
          id        BIGSERIAL PRIMARY KEY,
          track_id  BIGINT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
          seconds   INT NOT NULL DEFAULT 0,
          completed BOOLEAN NOT NULL DEFAULT FALSE,
          skipped   BOOLEAN NOT NULL DEFAULT FALSE,
          at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      await q`CREATE INDEX IF NOT EXISTS music_events_track_idx ON music_events (track_id, at)`;
      await q`CREATE INDEX IF NOT EXISTS music_events_at_idx ON music_events (at)`;
    },
  },
  {
    // Authoritative duration from Spotify, used to catch audio attached
    // to the wrong track (same file under several tracks).
    id: "2026-10-06-003-music-spotify-duration",
    up: async (q) => {
      await q`ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS spotify_duration_s INT`;
    },
  },
  // Example of the shape — the table it creates is the runner's own.
  {
    id: "2026-09-02-000-schema-migrations-bootstrap",
    up: async (q) => {
      await q`SELECT 1`;
    },
  },
  {
    // "Report a problem" on a library track (private player): what is
    // wrong (tick-boxes + free text) plus the playback context.
    id: "2026-10-08-001-music-reports",
    up: async (q) => {
      await q`
        CREATE TABLE IF NOT EXISTS music_reports (
          id           BIGSERIAL PRIMARY KEY,
          track_id     BIGINT NOT NULL,
          track_title  TEXT,
          reasons      TEXT[] NOT NULL DEFAULT '{}',
          note         TEXT,
          context      JSONB,
          status       TEXT NOT NULL DEFAULT 'open',
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          resolved_at  TIMESTAMPTZ
        )`;
      await q`CREATE INDEX IF NOT EXISTS music_reports_status_idx ON music_reports (status, id DESC)`;
    },
  },
  {
    // Audio analysis (tempo, key, timbre vector, …) and Spotify artist genres
    // per library track — drives "similar songs", radio and vibe groups.
    id: "2026-10-08-002-music-analysis",
    up: async (q) => {
      await q`
        CREATE TABLE IF NOT EXISTS music_features (
          track_id     BIGINT PRIMARY KEY,
          features     JSONB,
          bpm          REAL,
          key_name     TEXT,
          mode         TEXT,
          energy       REAL,
          brightness   REAL,
          beat         REAL,
          error        TEXT,
          version      INT NOT NULL DEFAULT 1,
          analyzed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      await q`
        CREATE TABLE IF NOT EXISTS music_track_genres (
          track_id    BIGINT PRIMARY KEY,
          genres      TEXT[] NOT NULL DEFAULT '{}',
          artists     TEXT[] NOT NULL DEFAULT '{}',
          fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
    },
  },
  {
    // "Login with Telegram" button: the browser opens t.me/<bot>?start=login_<nonce>,
    // the bot approves the request for an allowed account, the page polls.
    id: "2026-10-08-003-login-requests",
    up: async (q) => {
      await q`
        CREATE TABLE IF NOT EXISTS login_requests (
          nonce_hash   TEXT PRIMARY KEY,
          secret_hash  TEXT NOT NULL,
          status       TEXT NOT NULL DEFAULT 'pending',
          tg_user      JSONB,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at   TIMESTAMPTZ NOT NULL
        )`;
    },
  },
];

let ran: Promise<void> | null = null;

export async function runMigrations(q: Q): Promise<void> {
  if (ran) return ran;
  ran = (async () => {
    await q`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    const rows = (await q`SELECT id FROM schema_migrations`) as Array<{ id: string }>;
    const done = new Set(rows.map((r) => r.id));
    const pending = MIGRATIONS.filter((m) => !done.has(m.id)).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    for (const m of pending) {
      try {
        await m.up(q);
        await q`INSERT INTO schema_migrations (id) VALUES (${m.id}) ON CONFLICT DO NOTHING`;
      } catch (err) {
        // Stop at the first failure so later migrations never run against
        // a half-applied predecessor. The next boot retries from here.
        reportError("db:migrations", `migration ${m.id} failed:`, err);
        throw err;
      }
    }
  })().catch((err) => {
    ran = null; // allow a retry on the next call
    throw err;
  });
  return ran;
}
