// A ceiling on the page counter, separate from the one in front of the exports.
//
// Its own function because a rate limit is read from an edge function's exported `config`, and that config
// carries one limit for all the paths it names. The exports allow twenty a minute, which is generous for a
// CSV and would be absurd here: a reader working quickly through an Act's sections legitimately produces a
// beacon every second or two, and being throttled would silently stop counting the most engaged reading on
// the site.
//
// So the number is set where an honest reader cannot reach it and a script cannot do real damage. The
// endpoint itself is cheap -- one upsert into a table with one row per route per day -- but it is the only
// unauthenticated write the site has, and an unauthenticated write with no ceiling is how a free-tier
// database bill arrives.
//
// Inflating the counts is still possible under this, and that is accepted: these numbers inform what to
// collect next, they do not bill anyone. Making them tamper-proof would need exactly the identifier the
// counter exists without.
export default async (_request: Request, context: { next: () => Promise<Response> }) => context.next();

export const config = {
  path: "/api/beacon",
  rateLimit: {
    // Two a second sustained over a minute. Far above reading, far below a loop.
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
