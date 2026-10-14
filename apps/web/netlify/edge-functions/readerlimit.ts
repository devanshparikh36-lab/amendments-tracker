// A ceiling on the account endpoints.
//
// These are the only unauthenticated writes on the site that create rows keyed on something a stranger
// chooses. The beacon writes into a table bounded by the number of routes and the calendar; `/api/reader`
// inserts a row per email address it is handed, and the space of email addresses is infinite. Left open,
// a loop fills the reader table -- and with it the 0.5 GB the database is allowed -- in an afternoon, at
// no cost to whoever is running it.
//
// It cannot be solved by validating harder. The address is not verified and is not meant to be; signing in
// is deliberately free of confirmation so that using the site never waits on an email arriving. A ceiling
// is what stands in for the verification that was traded away.
//
// The number: a reader signing in makes two calls, then one per follow, bookmark or note. Working quickly
// through an Act and following a dozen sections is perhaps twenty calls in a minute. Forty leaves room for
// that and for a second tab, and still turns an unbounded loop into a trickle.
//
// Not a replacement for the application's own guards. The routes still cap name and note length, still
// reject a malformed address, and still evict a reader's oldest saved search at fifty. This only bounds
// how fast anyone may reach them.
export default async (_request: Request, context: { next: () => Promise<Response> }) => context.next();

export const config = {
  // Every account route, including the ones added later: the export is the most expensive of them and the
  // one most worth a ceiling, since it reads four tables and builds a file.
  path: ["/api/reader", "/api/reader/watch", "/api/reader/notes", "/api/reader/searches", "/api/reader/export"],
  rateLimit: {
    windowLimit: 40,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
