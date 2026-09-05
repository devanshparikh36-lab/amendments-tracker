import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, types } from "pg";
import * as schema from "./schema";

// Keep DATE columns as "YYYY-MM-DD" strings; the default conversion to a local-midnight Date shifts days in IST.
types.setTypeParser(types.builtins.DATE, (v) => v);

// One pool per serverless instance. Neon needs SSL; local Postgres does not.
const globalForDb = globalThis as unknown as { __pgPool?: Pool };

function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const needsSsl = !/localhost|127\.0\.0\.1/.test(url);
  return new Pool({
    connectionString: url,
    max: 4,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
}

export const pool = globalForDb.__pgPool ?? (globalForDb.__pgPool = makePool());
export const db = drizzle(pool, { schema });
export { schema };

// Plain SQL helper for the read paths that are easier to express directly (full-text search, aggregates).
export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
