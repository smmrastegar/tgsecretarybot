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
  {
    // Several private player links, each with its own set of playlists
    // (manual or smart), and rule-based "smart" playlists.
    id: "2026-10-09-001-player-links",
    up: async (q) => {
      await q`ALTER TABLE music_playlists ADD COLUMN IF NOT EXISTS rules JSONB`;
      await q`
        CREATE TABLE IF NOT EXISTS player_links (
          id            BIGSERIAL PRIMARY KEY,
          name          TEXT NOT NULL,
          token         TEXT NOT NULL UNIQUE,
          active        BOOLEAN NOT NULL DEFAULT TRUE,
          playlist_ids  BIGINT[] NOT NULL DEFAULT '{}',
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_used_at  TIMESTAMPTZ
        )`;
    },
  },
  {
    // Each player link keeps its own likes/dislikes and its own listening
    // history: events carry the link they came from (0 = Main link / dashboard).
    id: "2026-10-09-002-link-ratings-events",
    up: async (q) => {
      await q`ALTER TABLE music_events ADD COLUMN IF NOT EXISTS link_id BIGINT NOT NULL DEFAULT 0`;
      await q`CREATE INDEX IF NOT EXISTS music_events_link_idx ON music_events (link_id, track_id)`;
      await q`
        CREATE TABLE IF NOT EXISTS music_link_ratings (
          link_id   BIGINT NOT NULL,
          track_id  BIGINT NOT NULL,
          rating    SMALLINT NOT NULL,
          PRIMARY KEY (link_id, track_id)
        )`;
    },
  },
  {
    // A link may build its own smart playlists from a sample song (dashboard can switch it off per link).
    id: "2026-10-09-003-link-can-create",
    up: async (q) => {
      await q`ALTER TABLE player_links ADD COLUMN IF NOT EXISTS can_create_playlists BOOLEAN NOT NULL DEFAULT TRUE`;
    },
  },
  {
    // Content check of every library file against Spotify's 30 s preview of the song.
    id: "2026-10-09-004-music-verify",
    up: async (q) => {
      await q`
        CREATE TABLE IF NOT EXISTS music_verify (
          track_id    BIGINT PRIMARY KEY,
          status      TEXT NOT NULL,
          score       REAL,
          size_bytes  BIGINT,
          fixes       INT NOT NULL DEFAULT 0,
          checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
    },
  },
  {
    // The file's own ID3 title/artist, compared with what the library says the song is.
    id: "2026-10-09-005-music-verify-tags",
    up: async (q) => {
      await q`ALTER TABLE music_verify ADD COLUMN IF NOT EXISTS tags TEXT`;
      await q`ALTER TABLE music_verify ADD COLUMN IF NOT EXISTS tag_title TEXT`;
      await q`ALTER TABLE music_verify ADD COLUMN IF NOT EXISTS tag_artist TEXT`;
    },
  },
  {
    // An imported Spotify list belongs to ONE account (matched by account + source id, not by name,
    // so two accounts' lists with the same name no longer merge).
    id: "2026-10-09-006-playlist-account",
    up: async (q) => {
      await q`ALTER TABLE music_playlists ADD COLUMN IF NOT EXISTS spotify_account_id BIGINT`;
      await q`ALTER TABLE music_playlists ADD COLUMN IF NOT EXISTS spotify_source_id TEXT`;
      await q`
        UPDATE music_playlists p SET spotify_account_id = (e->>'accountId')::bigint, spotify_source_id = e->>'id'
          FROM settings s, jsonb_array_elements(s.value::jsonb) e
         WHERE s.key = 'musicSyncSources' AND s.value LIKE '[%' AND p.name = e->>'name' AND p.spotify_source_id IS NULL`;
    },
  },
  {
    // A song removed from the library stays removed: nothing (a Spotify list sync, an import, a pasted link)
    // may bring it back until the owner restores it.
    id: "2026-10-10-001-music-removed",
    up: async (q) => {
      await q`
        CREATE TABLE IF NOT EXISTS music_removed (
          spotify_id  TEXT PRIMARY KEY,
          title       TEXT,
          artist      TEXT,
          removed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
    },
  },
  {
    // Artists the owner follows: new releases are found periodically, downloaded, and added to a playlist
    // for that artist (library playlist keyed spotify_account_id = 0, spotify_source_id = "artist:<id>").
    id: "2026-10-11-001-music-artists",
    up: async (q) => {
      await q`
        CREATE TABLE IF NOT EXISTS music_artists (
          id                 BIGSERIAL PRIMARY KEY,
          spotify_artist_id  TEXT NOT NULL UNIQUE,
          name               TEXT NOT NULL,
          image_url          TEXT,
          followed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_checked_at    TIMESTAMPTZ,
          last_error         TEXT,
          seen_albums        TEXT NOT NULL DEFAULT '[]',
          seen_keys          TEXT NOT NULL DEFAULT '[]',
          track_count        INT NOT NULL DEFAULT 0
        )`;
    },
  },
  {
    // Which Spotify account(s) each library song came from (written by imports and syncs); drives the tiny
    // account marks in the library list and the "shared by every account" playlist.
    id: "2026-10-11-002-track-sources",
    up: async (q) => {
      await q`
        CREATE TABLE IF NOT EXISTS music_track_sources (
          track_id    BIGINT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
          account_id  BIGINT NOT NULL,
          PRIMARY KEY (track_id, account_id)
        )`;
      await q`
        INSERT INTO music_track_sources (track_id, account_id)
          SELECT DISTINCT pt.track_id, p.spotify_account_id
            FROM music_playlist_tracks pt JOIN music_playlists p ON p.id = pt.playlist_id
           WHERE p.spotify_account_id > 0
        ON CONFLICT DO NOTHING`;
    },
  },
  {
    // Bot chats are ~65 % of all logged messages and almost none matter day to day. They are kept out of the
    // main message/urgent lists unless the owner pins a specific bot into the main feed.
    id: "2026-10-12-001-bot-in-main",
    up: async (q) => {
      await q`ALTER TABLE chat_rules ADD COLUMN IF NOT EXISTS bot_in_main BOOLEAN NOT NULL DEFAULT FALSE`;
    },
  },
  {
    // A player link can be limited, at the data level, to the songs of chosen Spotify accounts.
    id: "2026-10-12-002-link-accounts",
    up: async (q) => {
      await q`ALTER TABLE player_links ADD COLUMN IF NOT EXISTS account_ids BIGINT[] NOT NULL DEFAULT '{}'`;
      await q`ALTER TABLE player_links ADD COLUMN IF NOT EXISTS accounts_mode TEXT NOT NULL DEFAULT 'any'`;
    },
  },
  {
    // A link may add songs to the Spotify "Liked Songs" of a connected account (off unless the owner allows it).
    id: "2026-10-13-001-link-spotify-like",
    up: async (q) => {
      await q`ALTER TABLE player_links ADD COLUMN IF NOT EXISTS can_like_spotify BOOLEAN NOT NULL DEFAULT FALSE`;
    },
  },
  {
    // Which permissions each Spotify account granted (so the dashboard can say "connect again" when saving songs is not allowed yet).
    id: "2026-10-13-002-spotify-scopes",
    up: async (q) => {
      await q`ALTER TABLE spotify_accounts ADD COLUMN IF NOT EXISTS scopes TEXT`;
    },
  },
  {
    // Several numeric passwords for playlist.bz, kept readable on purpose (the owner wants to see and copy them) and switchable one by one.
    id: "2026-10-13-003-music-pins",
    up: async (q) => {
      await q`
        CREATE TABLE IF NOT EXISTS music_pins (
          id            BIGSERIAL PRIMARY KEY,
          label         TEXT NOT NULL DEFAULT '',
          pin           TEXT NOT NULL UNIQUE,
          active        BOOLEAN NOT NULL DEFAULT TRUE,
          user_id       BIGINT NOT NULL,
          username      TEXT,
          first_name    TEXT,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_used_at  TIMESTAMPTZ
        )`;
    },
  },
  {
    // Each numeric password can be limited to the songs of chosen Spotify accounts (none chosen = everything).
    id: "2026-10-13-004-pin-accounts",
    up: async (q) => {
      await q`ALTER TABLE music_pins ADD COLUMN IF NOT EXISTS account_ids BIGINT[] NOT NULL DEFAULT '{}'`;
      await q`ALTER TABLE music_pins ADD COLUMN IF NOT EXISTS accounts_mode TEXT NOT NULL DEFAULT 'any'`;
    },
  },
  {
    // The player is English-only: playlists the app generated in Persian get English names.
    id: "2026-10-13-005-english-playlist-names",
    up: async (q) => {
      await q`UPDATE music_playlists SET name = regexp_replace(name, '^[^(]*', 'Liked ') WHERE name LIKE 'لایک‌ها (%'`;
      await q`UPDATE music_playlists SET name = '🤝 Shared by all accounts' WHERE name = '🤝 مشترک بین همهٔ حساب‌ها'`;
      await q`UPDATE music_playlists SET name = '👥 Shared by 2+ accounts' WHERE name = '👥 مشترک بین حداقل دو حساب'`;
    },
  },
  {
    // Songs sent by hand to the intake channel: marked source 'manual' (no re-download, no Spotify repair), plus the intake queue.
    id: "2026-10-15-001-music-intake",
    up: async (q) => {
      await q`ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'spotify'`;
      await q`
        CREATE TABLE IF NOT EXISTS music_intake (
          id              BIGSERIAL PRIMARY KEY,
          chat_id         BIGINT NOT NULL,
          message_id      BIGINT NOT NULL,
          file_id         TEXT NOT NULL,
          file_name       TEXT,
          file_size       BIGINT,
          duration_s      INT,
          tg_title        TEXT,
          tg_performer    TEXT,
          status          TEXT NOT NULL DEFAULT 'new',
          candidates      JSONB NOT NULL DEFAULT '[]',
          idx             INT NOT NULL DEFAULT 0,
          cover_idx       INT NOT NULL DEFAULT 0,
          local_path      TEXT,
          cover_path      TEXT,
          tags            JSONB,
          card_chat       BIGINT,
          card_message_id BIGINT,
          track_id        BIGINT,
          error           TEXT,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (chat_id, message_id)
        )`;
    },
  },
  {
    // A short voice clip in the intake channel is a question ("which song is this?"), not a song to keep.
    id: "2026-10-15-002-intake-kind",
    up: async (q) => {
      await q`ALTER TABLE music_intake ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'audio'`;
    },
  },
  {
    // SoundCloud: connected accounts, the one-time PKCE verifiers of sign-ins in progress, and SoundCloud songs in the library.
    id: "2026-10-20-001-soundcloud",
    up: async (q) => {
      await q`ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS soundcloud_id TEXT`;
      await q`ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS source_cover_url TEXT`;
      await q`CREATE UNIQUE INDEX IF NOT EXISTS music_tracks_soundcloud_id_idx ON music_tracks (soundcloud_id) WHERE soundcloud_id IS NOT NULL`;
      await q`
        CREATE TABLE IF NOT EXISTS soundcloud_accounts (
          id            BIGSERIAL PRIMARY KEY,
          sc_user_urn   TEXT NOT NULL UNIQUE,
          username      TEXT,
          refresh_token TEXT NOT NULL,
          access_token  TEXT,
          expires_at    TIMESTAMPTZ,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      await q`
        CREATE TABLE IF NOT EXISTS soundcloud_pkce (
          nonce      TEXT PRIMARY KEY,
          verifier   TEXT NOT NULL,
          host       TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL
        )`;
    },
  },
  {
    // Which SoundCloud account each imported song came from (shown as account marks, like Spotify's).
    id: "2026-10-20-002-soundcloud-sources",
    up: async (q) => {
      await q`
        CREATE TABLE IF NOT EXISTS music_track_sc_sources (
          track_id   BIGINT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
          account_id BIGINT NOT NULL REFERENCES soundcloud_accounts(id) ON DELETE CASCADE,
          PRIMARY KEY (track_id, account_id)
        )`;
    },
  },
  {
    // SoundCloud uploads carry the uploader as "artist" and messy titles: they are cleaned against Spotify's catalogue. The originals are kept.
    id: "2026-10-21-001-track-meta-state",
    up: async (q) => {
      await q`ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS meta_state TEXT NOT NULL DEFAULT ''`;
      await q`ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS meta_suggestions JSONB`;
      await q`ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS orig_title TEXT`;
      await q`ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS orig_artist TEXT`;
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
