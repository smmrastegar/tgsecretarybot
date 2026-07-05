# Migrating from Postgres (Neon) to TiDB / MySQL

The app was written for PostgreSQL. `lib/sql-driver.ts` adds a MySQL/
TiDB driver that translates the Postgres dialect at run time, so the
same query code runs on either engine. Postgres stays the default —
nothing changes until you opt in.

> ⚠️ This could not be tested against your TiDB from the build
> environment (no network route to `uk1.utoprop.org:4000`, and no
> access to the old Neon credentials). The steps below must be run and
> verified by you against the real TiDB.

## 1. Point the app at TiDB

Set env vars in Vercel (and redeploy):

```
DB_DRIVER=mysql
DATABASE_URL=mysql://tgsecretary-bot:<TIDB_PASSWORD>@uk1.utoprop.org:4000/tgsecretary-bot
```

(TiDB Cloud needs TLS — the driver enables it unless the URL has
`?ssl=false`. For a self-hosted TiDB without TLS append `?ssl=false`.)

On first request the app auto-creates every table (`ensureSchema`),
translated to MySQL DDL. Watch the logs for the first hit.

## 2. What the translator handles automatically

`$1`/tagged params, `::type` casts, `ILIKE`→`LIKE`, `= ANY(array)`→
`IN`, interval math (`NOW() - (n || ' seconds')::interval` and
`INTERVAL 'N days'`), `RETURNING id` (via insertId) + multi-column
RETURNING (via follow-up SELECT), `ON CONFLICT DO UPDATE`→
`ON DUPLICATE KEY UPDATE` + `EXCLUDED.x`→`VALUES(x)`, `DO NOTHING`→
`INSERT IGNORE`, DDL types (`BIGSERIAL`/`TIMESTAMPTZ`/`JSONB`/
`DEFAULT NOW()`), and partial indexes (`CREATE INDEX … WHERE` → full
index).

## 3. What still needs a manual rewrite (4 queries)

MySQL/TiDB has no `ARRAY_AGG(x ORDER BY y) FILTER (WHERE …)`. These use
the Postgres "most-recent value" idiom and will error on TiDB. Rewrite
each with the MySQL trick
`SUBSTRING_INDEX(GROUP_CONCAT(x ORDER BY y DESC SEPARATOR 0x01), 0x01, 1)`
or a correlated subquery:

- `lib/db.ts:2156` and `:2159` — `listGroupMembersFromMessages`
  (most-recent name/username per sender in the CSV export).
- `lib/db.ts:5298` — `(ARRAY_AGG(message_text ORDER BY created_at DESC))[1]`
  (last message preview).

These are non-critical (members CSV + a preview); the rest of the app
works without them.

## 4. Migrate the data

The app runs on either engine, but Postgres data must be copied into
TiDB. Because column types differ (jsonb→JSON, timestamptz→datetime,
bool→tinyint), a plain dump/restore won't work — use **pgloader**
(handles PG→MySQL type conversion) from a host that can reach BOTH
databases:

```
# pgloader command file (migrate.load)
LOAD DATABASE
  FROM postgresql://<neon-user>:<pass>@<neon-host>/<db>?sslmode=require
  INTO mysql://tgsecretary-bot:<TIDB_PASSWORD>@uk1.utoprop.org:4000/tgsecretary-bot
  WITH data only, include no drop, reset sequences, preserve index names
  SET mysql parameters foreign_key_checks='0';
```

```
pgloader migrate.load
```

Get the Neon connection string from Vercel → Settings → Environment
Variables (`DATABASE_URL`). Run `ensureSchema` first (step 1) so the
tables exist, then `data only` load fills them.

## 5. Verify before cutover

Run against TiDB with `DB_DRIVER=mysql` on a **preview deploy** first:
- Open `/health`, `/messages`, `/chats`, `/emails`, `/groups` — every
  page loads.
- Send a test Telegram message → it logs.
- Row counts match Neon: `SELECT COUNT(*)` on `messages_log`,
  `chat_rules`, `emails`, etc. on both sides.

Only flip production `DATABASE_URL` once the preview is clean.

## Rollback

Set `DB_DRIVER=postgres` (or remove it) and restore the Neon
`DATABASE_URL`. No code changes — the app returns to Postgres instantly.
