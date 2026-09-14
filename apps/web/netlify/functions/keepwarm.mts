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
// Cost: two function invocations every five minutes, about 17,000 a month against the 125,000 the free tier
// allows. It cannot be done from the page itself, because the whole problem is that nobody is visiting.
export default async () => {
  const base = process.env.URL ?? process.env.DEPLOY_URL;
  if (!base) {
    console.warn("keepwarm: neither URL nor DEPLOY_URL is set; nothing to ping");
    return;
  }
  const started = Date.now();
  try {
    const res = await fetch(`${base}/api/health`, { headers: { "user-agent": "as-amended-keepwarm" } });
    const body = await res.text();
    console.log(`keepwarm: ${res.status} in ${Date.now() - started}ms ${body.slice(0, 80)}`);
  } catch (err) {
    // Never throw: a failed ping must not mark the scheduled function as failing, which would bury the signal
    // if something genuinely breaks later.
    console.warn(`keepwarm: ping failed after ${Date.now() - started}ms`, err);
  }
};

// Every five minutes, which is the window Neon suspends in. Any slower and the suspend happens between pings.
export const config = { schedule: "*/5 * * * *" };
