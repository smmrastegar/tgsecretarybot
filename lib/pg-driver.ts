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
        max: 8,
        connectionTimeoutMillis: 20000,
        idleTimeoutMillis: 15000,
        // Don't let a query hang forever on the fragile remote DB.
        statement_timeout: 15000,
        query_timeout: 15000,
        keepAlive: true,
        ssl: disableSsl ? false : { rejectUnauthorized: false },
      });
    })();
    pools.set(url, p);
  }
  return p;
}

// A transient DB error is a dropped/refused/timed-out connection to the
// fragile self-hosted DB — safe to retry, and NOT worth logging as an
// error when it happens on a best-effort background write (telemetry,
// auto-extract). Exported so those call sites can stay quiet on it.
export function isTransientDbError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  const code = (e as { code?: string })?.code ?? "";
  return (
    /econnreset|connection terminated|timeout|too many clients|server closed|socket hang up|connection ended|ecconnrefused/.test(
      msg,
    ) ||
    ["ECONNRESET", "ETIMEDOUT", "57P01", "53300", "08006", "08003"].includes(
      code,
    )
  );
}

export function makePgClient(
  url: string,
  opts?: { tolerant?: boolean; errors?: string[] },
): SqlTagged {
  // The self-hosted DB occasionally drops/refuses a connection under a
  // burst (a page fires ~8 concurrent queries). Those are transient —
  // retry a couple of times on a fresh connection before surfacing a 500.
  const isTransient = isTransientDbError;
  const MAX_ATTEMPTS = 3;
  const run = async (
    text: string,
    params: unknown[],
  ): Promise<Record<string, unknown>[]> => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const pool = await getPgPool(url);
      try {
        const res = await pool.query(text, params as unknown[]);
        return (res.rows ?? []) as Record<string, unknown>[];
      } catch (e) {
        if (opts?.tolerant) {
          // Tolerant mode (schema init): swallow per-statement errors so
          // ensureSchema runs to completion.
          opts.errors?.push(`${e instanceof Error ? e.message : e} :: ${text.slice(0, 100)}`);
          return [];
        }
        if (attempt < MAX_ATTEMPTS - 1 && isTransient(e)) {
          // Backoff grows per attempt (150ms, 400ms) to let the fragile
          // remote DB recover from a burst before we give up.
          await new Promise((r) => setTimeout(r, attempt === 0 ? 150 : 400));
          continue;
        }
        throw e;
      }
    }
    return [];
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
