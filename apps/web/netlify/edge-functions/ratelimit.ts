// A rate limit in front of the endpoints that are expensive and not interactive.
//
// Deliberately no `import type { Config } from "@netlify/edge-functions"`: that package is not a dependency
// here, and Netlify reads the exported `config` object whether or not it carries a type annotation. The same
// reasoning as netlify/functions/keepwarm.mts.
//
// Why an edge function at all, when the limit is about routes that live in the Next.js app: rate limits are
// read from an edge function's exported config and cannot be set in netlify.toml. They also cannot be set on
// a Next.js route handler, because the Next runtime bundles every route into one server function and
// per-route config is ignored -- the behaviour Nuxt users hit and reported. An edge function declaring the
// paths itself is the only form that works, and it runs before the server function, so a refused request
// costs nothing beyond the refusal.
//
// Why caching alone is not enough, which was the first answer tried: the exports are now cached for an hour
// at the edge, and the cache key includes the query string. So `?q=<random>` on every call produces a unique
// key, misses the cache every time, and reaches the function with a thousand-row Neon query behind it. The
// cache makes honest repetition free; it does nothing about repetition designed to miss it.
//
// What is NOT limited, and why. `/api/suggest` and `/api/sections/*` are left alone on purpose: they are
// called per keystroke by real readers, a limit low enough to matter would be hit by a fast typist, and both
// are already cached for an hour and cheap to serve. Putting an edge function in their path would add an
// invocation to the hot path to defend the cheap case while the expensive one went unguarded.
export default async (_request: Request, context: { next: () => Promise<Response> }) => context.next();

export const config = {
  path: ["/api/export/documents", "/api/export/section-map", "/feed.xml"],
  rateLimit: {
    // Twenty a minute per address. A person exporting a CSV does it once and then reads it; a feed reader
    // polls at most every few minutes. Twenty leaves room for a retried download and a handful of
    // subscriptions from one office behind one address, and still turns an unbounded loop into a trickle.
    windowLimit: 20,
    windowSize: 60,
    // Per address, not pooled across the site: pooling is an Enterprise feature, and pooling would also mean
    // one noisy caller could exhaust everyone else's allowance, which is the wrong failure.
    aggregateBy: ["ip", "domain"],
  },
};
