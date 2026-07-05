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

export function driverKind(): "postgres" | "mysql" {
  const forced = (process.env.DB_DRIVER ?? "").toLowerCase();
  if (forced === "mysql" || forced === "tidb") return "mysql";
  if (forced === "postgres" || forced === "pg") return "postgres";
  const url = config.databaseUrl ?? "";
  if (/^mysql:\/\//i.test(url)) return "mysql";
  return "postgres";
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

  return { sql: s, returning };
}

// ── MySQL/TiDB client (lazy) ────────────────────────────────────
let poolPromise: Promise<import("mysql2/promise").Pool> | null = null;

async function getPool(): Promise<import("mysql2/promise").Pool> {
  if (!poolPromise) {
    poolPromise = (async () => {
      const mysql = await import("mysql2/promise");
      const url = config.databaseUrl ?? "";
      return mysql.createPool({
        uri: url,
        connectionLimit: 5,
        // TiDB Cloud requires TLS; self-hosted may not. Enable if the
        // URL doesn't already disable it.
        ssl: /sslmode=disable|ssl=false/i.test(url)
          ? undefined
          : { rejectUnauthorized: false },
        supportBigNumbers: true,
        bigNumberStrings: true,
        dateStrings: false,
      });
    })();
  }
  return poolPromise;
}

async function runMysql(
  text: string,
  params: unknown[],
): Promise<Record<string, unknown>[]> {
  const pool = await getPool();
  const { sql: translated, returning } = pgToMysql(text);
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

export function makeMysqlClient(): SqlTagged {
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
    return runMysql(text, params);
  }) as SqlTagged;
  fn.query = (text: string, p: unknown[] = []) => {
    // The app uses $1,$2 in a couple of .query() call sites — convert.
    const converted = text.replace(/\$(\d+)/g, "?");
    return runMysql(converted, p);
  };
  return fn;
}
