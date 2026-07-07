// A node-postgres client with the SAME tagged-template + .query surface
// as the neon client, so ensureSchema and the migration tools can run
// against an ARBITRARY Postgres URL (the new self-hosted DB) — no
// dialect translation, since both source and target are Postgres.
import type { Pool as PgPool } from "pg";
import type { SqlTagged } from "./sql-driver";

const pools = new Map<string, Promise<PgPool>>();

export async function getPgPool(url: string): Promise<PgPool> {
  let p = pools.get(url);
  if (!p) {
    p = (async () => {
      const { Pool } = await import("pg");
      const disableSsl = /sslmode=disable/i.test(url);
      // Strip sslmode from the URL — otherwise node-postgres enforces
      // cert verification from the connection string and ignores the
      // ssl option below, failing on the server's self-signed cert.
      const clean = url
        .replace(/([?&])sslmode=[^&]*/gi, "$1")
        .replace(/[?&]+$/,"")
        .replace(/([?&])&+/g, "$1");
      return new Pool({
        connectionString: clean,
        max: 4,
        connectionTimeoutMillis: 20000,
        idleTimeoutMillis: 15000,
        ssl: disableSsl ? false : { rejectUnauthorized: false },
      });
    })();
    pools.set(url, p);
  }
  return p;
}

export function makePgClient(
  url: string,
  opts?: { tolerant?: boolean; errors?: string[] },
): SqlTagged {
  const run = async (
    text: string,
    params: unknown[],
  ): Promise<Record<string, unknown>[]> => {
    const pool = await getPgPool(url);
    try {
      const res = await pool.query(text, params as unknown[]);
      return (res.rows ?? []) as Record<string, unknown>[];
    } catch (e) {
      // Tolerant mode (schema init): swallow per-statement errors so
      // ensureSchema runs to completion. Ordering issues (an ALTER on a
      // table created later) resolve on a second pass.
      if (opts?.tolerant) {
        opts.errors?.push(`${e instanceof Error ? e.message : e} :: ${text.slice(0, 100)}`);
        return [];
      }
      throw e;
    }
  };
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    // Rebuild with $1,$2… placeholders (Postgres native), matching neon.
    let text = "";
    const params: unknown[] = [];
    strings.forEach((chunk, i) => {
      text += chunk;
      if (i < values.length) {
        params.push(values[i]);
        text += `$${params.length}`;
      }
    });
    return run(text, params);
  }) as SqlTagged;
  fn.query = (text: string, p: unknown[] = []) => run(text, p);
  return fn;
}
