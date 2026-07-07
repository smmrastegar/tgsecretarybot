// ────────────────────────────────────────────────────────────────
// Database driver abstraction: Postgres (Neon) OR MySQL/TiDB.
//
// The whole app is written against Postgres via the neon tagged
// template. To run on TiDB (MySQL wire protocol) without rewriting
// every one of the ~hundreds of queries by hand, this module provides
// a drop-in `sql` client backed by mysql2 that translates the Postgres
// dialect to MySQL at run time.
//
// Selection (lib/db.ts `sql()` delegates here):
//   DB_DRIVER=mysql   → use TiDB/MySQL (this module)
//   DB_DRIVER=postgres OR unset → use neon (default; unchanged)
//   A mysql:// connection string also implies mysql.
//
// The translator handles the mechanical differences (casts, ILIKE,
// RETURNING id, ON CONFLICT → ON DUPLICATE KEY, interval math, DDL
// types, = ANY(array) → IN). Constructs with NO MySQL equivalent
// (ARRAY_AGG(... ORDER BY) FILTER (WHERE ...)) must be rewritten
// per-query — see docs/TIDB_MIGRATION.md for the checklist.
// ────────────────────────────────────────────────────────────────
import { config } from "./config";

export type SqlTagged = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<
    Record<string, unknown>[]
  >;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

// "neon"     → @neondatabase/serverless HTTP driver (Neon only)
// "pg"       → node-postgres (any standard/self-hosted Postgres)
// "mysql"    → mysql2 + dialect translation (TiDB/MySQL)
export function driverKind(): "neon" | "pg" | "mysql" {
  const forced = (process.env.DB_DRIVER ?? "").toLowerCase();
  if (forced === "mysql" || forced === "tidb") return "mysql";
  if (forced === "pg" || forced === "postgres") return "pg";
  if (forced === "neon") return "neon";
  const url = config.databaseUrl ?? "";
  if (/^mysql:\/\//i.test(url)) return "mysql";
  // A Postgres URL that isn't a Neon host → use node-postgres. Neon
  // hosts (neon.tech / neon.build) keep the HTTP driver.
  if (/^postgres(ql)?:\/\//i.test(url) && !/neon\.(tech|build|com)/i.test(url)) {
    return "pg";
  }
  return "neon";
}

// ── Postgres → MySQL dialect translation ────────────────────────
// Returns the rewritten SQL plus metadata the runtime needs (RETURNING
// columns, since MySQL has no RETURNING).
export function pgToMysql(text: string): {
  sql: string;
  returning: string[] | null;
} {
  let s = text;

  // 1) RETURNING <cols> — capture then strip (MySQL has none).
  let returning: string[] | null = null;
  const retMatch = /\bRETURNING\s+([\s\S]+?)\s*$/i.exec(s);
  if (retMatch) {
    returning = (retMatch[1] ?? "")
      .replace(/;+\s*$/, "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    s = s.slice(0, retMatch.index).trimEnd();
  }

  // 2) Interval math BEFORE stripping casts.
  //    NOW() - (X || ' seconds')::interval  →  NOW() - INTERVAL X SECOND
  s = s.replace(
    /\(\s*([^()]+?)\s*\|\|\s*'\s*seconds?\s*'\s*\)\s*::\s*interval/gi,
    "INTERVAL $1 SECOND",
  );
  //    INTERVAL '<n> <unit>'  →  INTERVAL <n> <UNIT>
  s = s.replace(
    /INTERVAL\s+'(\d+)\s*(second|minute|hour|day|week|month|year)s?'/gi,
    (_m, n, u) => `INTERVAL ${n} ${String(u).toUpperCase()}`,
  );

  // 3) = ANY(<x>[]) → IN (<x>)   (mysql2 .query expands an array param)
  s = s.replace(/=\s*ANY\s*\(([^)]*?)\)/gi, "IN ($1)");

  // 4) Drop remaining ::type casts (incl. ::bigint[] etc.). MySQL is
  //    loosely typed; comparisons still work with the bare value.
  s = s.replace(/::\s*[a-z_]+(\s*\[\s*\])?/gi, "");

  // 5) ILIKE → LIKE (MySQL default collation is case-insensitive).
  s = s.replace(/\bILIKE\b/gi, "LIKE");

  // 6) ON CONFLICT (...) DO UPDATE SET ...  →  ON DUPLICATE KEY UPDATE ...
  //    and EXCLUDED.col → VALUES(col).
  s = s.replace(
    /ON\s+CONFLICT\s*(\([^)]*\))?\s*DO\s+UPDATE\s+SET/gi,
    "ON DUPLICATE KEY UPDATE",
  );
  s = s.replace(/EXCLUDED\.([a-z_][a-z0-9_]*)/gi, "VALUES($1)");
  //    ON CONFLICT ... DO NOTHING → make the INSERT ignore duplicates.
  if (/ON\s+CONFLICT[\s\S]*?DO\s+NOTHING/i.test(s)) {
    s = s.replace(/ON\s+CONFLICT\s*(\([^)]*\))?\s*DO\s+NOTHING/gi, "");
    s = s.replace(/^\s*INSERT\s+INTO/i, "INSERT IGNORE INTO");
  }

  // 7) DDL type mapping (CREATE TABLE / ALTER).
  s = s
    .replace(/\bBIGSERIAL\b/gi, "BIGINT AUTO_INCREMENT")
    .replace(/\bSERIAL\b/gi, "INT AUTO_INCREMENT")
    .replace(/\bTIMESTAMPTZ\b/gi, "DATETIME")
    .replace(/\bTIMESTAMP\b(?!\s+WITH)/gi, "DATETIME")
    .replace(/\bJSONB\b/gi, "JSON")
    .replace(/DEFAULT\s+NOW\(\)/gi, "DEFAULT CURRENT_TIMESTAMP");

  // 8) Partial indexes: MySQL/TiDB have none. Strip the WHERE clause of
  //    a CREATE [UNIQUE] INDEX so it becomes a full index (correct, just
  //    slightly larger). Only touches CREATE INDEX statements.
  if (/^\s*CREATE\s+(UNIQUE\s+)?INDEX/i.test(s) && /\sWHERE\s/i.test(s)) {
    s = s.replace(/\sWHERE\s[\s\S]*$/i, "");
  }

  // 9) CREATE TABLE / ALTER TABLE fixups for MySQL/TiDB. (Some columns
  //    like `source` are added later via ALTER TABLE ADD COLUMN, so the
  //    type fixes must apply there too — not just CREATE TABLE.)
  if (/CREATE\s+TABLE|ALTER\s+TABLE/i.test(s)) {
    // (a) TEXT can't be a key. Inline `TEXT [NOT NULL] PRIMARY KEY|UNIQUE`
    //     → VARCHAR(255).
    s = s.replace(
      /\bTEXT\b(\s+NOT\s+NULL)?\s+(PRIMARY\s+KEY|UNIQUE)/gi,
      "VARCHAR(255)$1 $2",
    );
    // (b) TEXT columns named in a composite PRIMARY KEY / UNIQUE (…) →
    //     VARCHAR(255) so the key is valid.
    const keyCols = new Set<string>();
    for (const m of s.matchAll(/(?:PRIMARY\s+KEY|UNIQUE(?:\s+KEY)?)\s*\(([^)]+)\)/gi)) {
      (m[1] ?? "").split(",").forEach((c) => {
        const n = c.trim().replace(/[`"]/g, "");
        if (n) keyCols.add(n);
      });
    }
    for (const col of keyCols) {
      s = s.replace(new RegExp(`(\\b${col}\\b\\s+)TEXT\\b`, "i"), "$1VARCHAR(255)");
    }
    // (b1) Short identifier columns that are INDEXED must be VARCHAR
    //      (MySQL can't index TEXT without a prefix length). These all
    //      hold short values so VARCHAR(255) is safe. Long-content
    //      columns (message_text, html_body, notes, …) stay TEXT.
    // Every column that appears in any CREATE INDEX. Only the TEXT ones
    // actually convert (the regex won't match BIGINT/DATETIME columns),
    // so listing numeric/date columns here is harmless.
    const INDEXED_TEXT = [
      "source", "function_role", "role", "status", "thread_key",
      "phone_tail", "level", "business_connection_id", "analytics_share_token",
      "body_signature", "prompt_hash", "purpose", "update_type", "kind",
      "secret", "platform", "external_id",
      // short identifier columns commonly used as keys/lookups
      "name", "username", "slug", "token", "concept", "label",
      // short enum-like columns that carry a DEFAULT (MySQL forbids
      // DEFAULT on TEXT) — VARCHAR keeps the default working.
      "mode", "notify_on", "plan", "scrape_mode", "check_hours_tehran",
      "skip_weekdays", "password_field", "username_field", "priority",
      "direction", "relationship", "chat_type",
    ];
    for (const col of INDEXED_TEXT) {
      s = s.replace(new RegExp(`(\\b${col}\\s+)TEXT\\b`, "gi"), "$1VARCHAR(255)");
    }
    // (b2) TEXT/JSON/BLOB columns can't have a DEFAULT in MySQL. Drop it.
    s = s.replace(
      /\b(TEXT|JSON|BLOB|LONGTEXT|MEDIUMTEXT)\b(\s+NOT\s+NULL)?\s+DEFAULT\s+('(?:[^']|'')*'|[^,)\s]+)/gi,
      "$1$2",
    );
    // (c) Backtick reserved-word column names (key, value, …) — MySQL
    //     rejects them unquoted, Postgres allowed them.
    const RESERVED = [
      "key", "value", "order", "status", "rank", "read", "usage",
      "interval", "groups", "lock", "range", "rows", "system", "keys",
    ];
    const TYPES =
      "TEXT|VARCHAR|BIGINT|INTEGER|INT|BOOLEAN|JSON|DATETIME|TIMESTAMP|NUMERIC|REAL|DOUBLE|SMALLINT";
    for (const w of RESERVED) {
      // column definition: (or , ) <w> <TYPE>
      s = s.replace(
        new RegExp(`([(,]\\s*)${w}(\\s+(?:${TYPES}))`, "gi"),
        "$1`" + w + "`$2",
      );
      // key list: ( … , <w> , … )
      s = s.replace(new RegExp(`([(,]\\s*)${w}(\\s*[),])`, "gi"), "$1`" + w + "`$2");
    }
  }

  return { sql: s, returning };
}

// ── MySQL/TiDB client (lazy, pooled per connection URL) ─────────
const pools = new Map<string, Promise<import("mysql2/promise").Pool>>();

export async function getPool(
  urlOverride?: string,
): Promise<import("mysql2/promise").Pool> {
  const url = urlOverride ?? config.databaseUrl ?? "";
  let p = pools.get(url);
  if (!p) {
    p = (async () => {
      const mysql = await import("mysql2/promise");
      return mysql.createPool({
        uri: url,
        // Gentle: small servers (free TiDB) have low max_connections;
        // don't exhaust them + release idle connections quickly.
        connectionLimit: 3,
        maxIdle: 1,
        idleTimeout: 20000,
        connectTimeout: 20000,
        enableKeepAlive: false,
        // TiDB Cloud requires TLS; self-hosted may not. Enable unless
        // the URL disables it.
        ssl: /sslmode=disable|ssl=false/i.test(url)
          ? undefined
          : { rejectUnauthorized: false },
        supportBigNumbers: true,
        bigNumberStrings: true,
        dateStrings: false,
      });
    })();
    pools.set(url, p);
  }
  return p;
}

// Drop a cached pool (e.g. after a connection error) so the next call
// builds a fresh one instead of reusing hung connections.
export function evictPool(urlOverride?: string): void {
  pools.delete(urlOverride ?? config.databaseUrl ?? "");
}

async function runMysql(
  text: string,
  params: unknown[],
  urlOverride?: string,
): Promise<Record<string, unknown>[]> {
  const pool = await getPool(urlOverride);
  const { sql: translated, returning } = pgToMysql(text);

  // Postgres `ALTER COLUMN col DROP NOT NULL` has no MySQL equivalent —
  // MySQL needs `MODIFY COLUMN col <type> NULL`, which requires the
  // current type. Resolve it at run time (we have the connection) and
  // rewrite. No-op if the column doesn't exist yet.
  const dropNN =
    /ALTER\s+TABLE\s+`?(\w+)`?\s+ALTER\s+COLUMN\s+`?(\w+)`?\s+DROP\s+NOT\s+NULL/i.exec(
      translated,
    );
  if (dropNN) {
    const tbl = dropNN[1];
    const col = dropNN[2];
    const [ct] = await pool.query(
      "SELECT column_type FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?",
      [tbl, col],
    );
    const colType = (ct as { column_type?: string }[])[0]?.column_type;
    if (colType) {
      await pool.query(
        `ALTER TABLE \`${tbl}\` MODIFY COLUMN \`${col}\` ${colType} NULL`,
      );
    }
    return [];
  }

  // Use .query (not .execute) so array params expand for IN (?).
  const [result] = await pool.query(translated, params);
  // SELECT → rows array. INSERT/UPDATE/DELETE → ResultSetHeader.
  if (Array.isArray(result)) {
    return result as Record<string, unknown>[];
  }
  const header = result as {
    insertId?: number;
    affectedRows?: number;
  };
  if (returning && returning.length > 0) {
    // Emulate RETURNING. For a single auto-increment "id" after INSERT,
    // hand back the new id. Multi-column RETURNING needs a follow-up
    // SELECT keyed on the new id.
    const onlyId =
      returning.length === 1 && /^id$/i.test(returning[0] ?? "");
    if (onlyId && header.insertId != null) {
      return [{ id: header.insertId }];
    }
    if (header.insertId != null) {
      const table = /INSERT\s+(?:IGNORE\s+)?INTO\s+([`"]?[a-z_][a-z0-9_]*[`"]?)/i.exec(translated)?.[1];
      if (table) {
        const cols = returning.includes("*") ? "*" : returning.join(", ");
        const [rows2] = await pool.query(
          `SELECT ${cols} FROM ${table} WHERE id = ?`,
          [header.insertId],
        );
        if (Array.isArray(rows2)) return rows2 as Record<string, unknown>[];
      }
    }
    // DELETE/UPDATE ... RETURNING: we can't recover the rows, but
    // callers that only use `.length` still get the right count.
    return Array.from({ length: header.affectedRows ?? 0 }, () => ({}));
  }
  return [];
}

// A recording client: instead of executing, it translates each
// parameterless DDL statement and pushes it into `out`. Statements with
// bound params (backfill data-migrations) are no-ops on a fresh DB and
// are skipped. Used by tidb_init_schema to collect the whole schema
// then run it in a few batched round-trips (avoids ~150 slow ones).
export function makeCaptureClient(out: string[]): SqlTagged {
  const capture = (text: string, hasParams: boolean) => {
    if (hasParams) return Promise.resolve([] as Record<string, unknown>[]);
    if (!/^\s*(CREATE|ALTER|DROP)\b/i.test(text)) {
      return Promise.resolve([] as Record<string, unknown>[]);
    }
    out.push(pgToMysql(text).sql);
    return Promise.resolve([] as Record<string, unknown>[]);
  };
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = "";
    strings.forEach((chunk, i) => {
      text += chunk;
      if (i < values.length) text += "?";
    });
    return capture(text, values.length > 0);
  }) as SqlTagged;
  fn.query = (text: string, p: unknown[] = []) => capture(text, p.length > 0);
  return fn;
}

export function makeMysqlClient(urlOverride?: string): SqlTagged {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    // Rebuild the query with ? placeholders + collect params, matching
    // how the neon tag would parameterise it.
    let text = "";
    const params: unknown[] = [];
    strings.forEach((chunk, i) => {
      text += chunk;
      if (i < values.length) {
        text += "?";
        params.push(values[i]);
      }
    });
    return runMysql(text, params, urlOverride);
  }) as SqlTagged;
  fn.query = (text: string, p: unknown[] = []) => {
    // The app uses $1,$2 in a couple of .query() call sites — convert.
    const converted = text.replace(/\$(\d+)/g, "?");
    return runMysql(converted, p, urlOverride);
  };
  return fn;
}
