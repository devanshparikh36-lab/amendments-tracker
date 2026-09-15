import { cache } from "react";
import { unstable_cache } from "next/cache";
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

/** The connection pool, built on first use rather than on import.
 *
 * This used to run at module scope, which meant importing this file demanded DATABASE_URL — and `next build`
 * imports every route module while collecting them. On a site whose environment has not been filled in yet the
 * build therefore died with "DATABASE_URL is not set", exit code 2, before rendering anything. A brand new
 * Netlify site failed its first build for exactly that reason, which reads as a broken repository rather than
 * an unset variable.
 *
 * Nothing about the build needs a database: every page here is rendered per request. So the requirement should
 * arrive with the first query, not with the import.
 */
export function getPool(): Pool {
  return (globalForDb.__pgPool ??= makePool());
}

export { schema };

// How long a query result may be reused. Collection runs every six hours, so minutes of staleness cost
// nothing, while the saving is the entire round trip: opening a connection to Neon costs ~1.9s from cold
// (the free plan suspends the compute when idle) and each query another 150-300ms on top. Every page was
// paying that on every click, because every route was marked force-dynamic.
const CACHE_SECONDS = Number(process.env.QUERY_CACHE_SECONDS ?? 600);

async function runQuery<T>(text: string, params: unknown[]): Promise<T[]> {
  const started = Date.now();
  const res = await getPool().query(text, params);
  // LOG_DB_HITS=1 prints every query that actually reached Neon, which is the only way to tell a cache hit
  // from a miss: the page timing alone cannot, especially in development where the data cache is disabled.
  if (process.env.LOG_DB_HITS) {
    console.log(`[db] ${Date.now() - started}ms  ${text.replace(/\s+/g, " ").slice(0, 70)}`);
  }
  return res.rows as T[];
}

// Plain SQL helper for the read paths that are easier to express directly (full-text search, aggregates).
// Cached on the SQL and its parameters, so identical reads share one result across requests and visitors.
// Safe because every page here shows the same public content to everyone: the passcode gate is a door, not
// a per-visitor view, so no cache entry can carry one person's data to another.
// Two layers, because they solve different problems.
//
// React's cache() deduplicates within a single render: generateMetadata and the page body both ask for the
// same instrument, and without this that is two round trips on every instrument page. It works everywhere,
// including development.
//
// unstable_cache reuses results across requests and visitors. Next disables the data cache in development, so
// its effect only shows once deployed -- do not conclude from a dev timing that it is not working.
const readThrough = cache(async (text: string, paramsJson: string, ttlSeconds: number): Promise<unknown[]> => {
  const params = JSON.parse(paramsJson) as unknown[];
  if (!ttlSeconds) return runQuery<unknown>(text, params);
  const cached = unstable_cache(() => runQuery<unknown>(text, params), ["sql", text, paramsJson], {
    revalidate: ttlSeconds,
    tags: ["db"],
  });
  return cached();
});

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
  ttlSeconds: number = CACHE_SECONDS,
): Promise<T[]> {
  return (await readThrough(text, JSON.stringify(params), ttlSeconds)) as T[];
}

// For readings that are about freshness itself -- collector health, queue depth, "last checked" -- where a
// ten-minute-old answer would be worse than a slow one, because the whole point of the number is whether
// the pipeline is alive right now.
export const LIVE_SECONDS = 30;
