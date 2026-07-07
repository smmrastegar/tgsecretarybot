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
      return new Pool({
        connectionString: url,
        max: 4,
        connectionTimeoutMillis: 20000,
        idleTimeoutMillis: 15000,
        // Self-hosted PG with sslmode=require but often a self-signed
        // cert — don't fail verification.
        ssl: /sslmode=disable/i.test(url)
          ? false
          : { rejectUnauthorized: false },
      });
    })();
    pools.set(url, p);
  }
  return p;
}

export function makePgClient(url: string): SqlTagged {
  const run = async (
    text: string,
    params: unknown[],
  ): Promise<Record<string, unknown>[]> => {
    const pool = await getPgPool(url);
    const res = await pool.query(text, params as unknown[]);
    return (res.rows ?? []) as Record<string, unknown>[];
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
