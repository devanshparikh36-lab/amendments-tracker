// Keeps the database awake, from Netlify's own infrastructure.
//
// Deliberately no `import type { Config } from "@netlify/functions"`: that package is not a dependency here,
// and Netlify reads the exported `config` object regardless of whether it carries a type annotation. Adding a
// dependency to name one object's shape is not worth it.
//
// Neon's free plan suspends its compute after about five minutes idle. A visitor arriving after a quiet spell
// therefore pays three costs at once: the Netlify function cold-starting, Neon waking, and the page itself --
// and Netlify kills a function at ten seconds. That is what "This function has crashed" was: not a bug in the
// page, but the sum of three slow things landing on one unlucky request.
//
// A local scheduled task used to do this every four minutes. It was disabled when collection moved off the
// laptop, which removed the only thing preventing the suspend -- so the crash appeared hours later, with
// nothing in the code having changed. This does the same job with no machine of ours involved.
//
// It connects to Neon directly rather than fetching this site's own /api/health, and that halves what it
// costs. Going over HTTP meant two invocations every tick -- this function, and the health route it called --
// roughly 576 a day for one `SELECT 1`. Billing moved to credits on 5 Oct 2026, so the old note here
// ("17,000 a month against the 125,000 the free tier allows") was reasoning against a tier that no longer
// exists; with nobody visiting a quiet site, this schedule was the largest single consumer on the account.
//
// What the HTTP ping did additionally was keep the Next.js server function warm. That matters much less now:
// since the caching fix, the pages worth warming are served from the CDN and never reach a function at all,
// while Neon waking was always the expensive half at ~1.9s.
export default async () => {
  const started = Date.now();
  const url = process.env.DATABASE_URL;

  if (url) {
    // Imported inside the try, not at the top of the file. A top-level import that failed to bundle would
    // throw before this function body ran at all, and the fallback below -- the entire reason it is safe to
    // change this -- would never get the chance to cover for it.
    let client: { connect(): Promise<void>; query(q: string): Promise<unknown>; end(): Promise<void> } | null = null;
    try {
      const { Client } = await import("pg");
      client = new Client({
        connectionString: url,
        // Same as the site's pool: Neon requires TLS, and the chain is not verified here for the same
        // reason it is not there.
        ssl: { rejectUnauthorized: false },
        // Well inside Netlify's ten-second ceiling. A connection that has not opened in five seconds is not
        // going to, and failing fast leaves time for the fallback.
        connectionTimeoutMillis: 5000,
      });
      await client.connect();
      await client.query("SELECT 1");
      console.log(`keepwarm: database awake in ${Date.now() - started}ms (direct)`);
      return;
    } catch (err) {
      console.warn(`keepwarm: direct connection failed after ${Date.now() - started}ms, falling back to HTTP`, err);
    } finally {
      // Never let a failed close mask the result above, or throw out of the function.
      try {
        await client?.end();
      } catch {
        /* the connection is going away regardless */
      }
    }
  } else {
    console.warn("keepwarm: DATABASE_URL is not set; falling back to HTTP");
  }

  // The old path, kept as the fallback rather than deleted. If `pg` ever fails to resolve in this function's
  // bundle, this keeps Neon awake at the cost it always had instead of silently stopping -- and a site whose
  // database suspends is slow for real visitors, which is worse than two invocations.
  const base = process.env.URL ?? process.env.DEPLOY_URL;
  if (!base) {
    console.warn("keepwarm: neither URL nor DEPLOY_URL is set; nothing to ping");
    return;
  }
  try {
    const res = await fetch(`${base}/api/health`, { headers: { "user-agent": "as-amended-keepwarm" } });
    const body = await res.text();
    console.log(`keepwarm: ${res.status} in ${Date.now() - started}ms ${body.slice(0, 80)} (http fallback)`);
  } catch (err) {
    // Never throw: a failed ping must not mark the scheduled function as failing, which would bury the signal
    // if something genuinely breaks later.
    console.warn(`keepwarm: ping failed after ${Date.now() - started}ms`, err);
  }
};

// Every five minutes, which is the window Neon suspends in. Any slower and the suspend happens between pings.
export const config = { schedule: "*/5 * * * *" };
