import { unstable_cache } from "next/cache";
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

// How long a query result may be reused. Collection runs every six hours, so minutes of staleness cost
// nothing, while the saving is the entire round trip: opening a connection to Neon costs ~1.9s from cold
// (the free plan suspends the compute when idle) and each query another 150-300ms on top. Every page was
// paying that on every click, because every route was marked force-dynamic.
const CACHE_SECONDS = Number(process.env.QUERY_CACHE_SECONDS ?? 600);

async function runQuery<T>(text: string, params: unknown[]): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

// Plain SQL helper for the read paths that are easier to express directly (full-text search, aggregates).
// Cached on the SQL and its parameters, so identical reads share one result across requests and visitors.
// Safe because every page here shows the same public content to everyone: the passcode gate is a door, not
// a per-visitor view, so no cache entry can carry one person's data to another.
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
  ttlSeconds: number = CACHE_SECONDS,
): Promise<T[]> {
  if (!ttlSeconds) return runQuery<T>(text, params);
  const cached = unstable_cache(() => runQuery<T>(text, params), ["sql", text, JSON.stringify(params)], {
    revalidate: ttlSeconds,
    tags: ["db"],
  });
  return cached();
}

// For readings that are about freshness itself -- collector health, queue depth, "last checked" -- where a
// ten-minute-old answer would be worse than a slow one, because the whole point of the number is whether
// the pipeline is alive right now.
export const LIVE_SECONDS = 30;
