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
  //
  // /api/admin/readers is here too, and for a different reason than the rest. It is key-guarded rather
  // than open, so it is not a row-flooding risk -- but it is the one endpoint on the site where guessing
  // correctly is worth something, and an unthrottled POST is an invitation to try. A long random ADMIN_KEY
  // is not brute-forceable at any rate, so this is defence in depth against a short one.
  path: [
    "/api/reader",
    "/api/reader/watch",
    "/api/reader/notes",
    "/api/reader/searches",
    "/api/reader/export",
    "/api/admin/readers",
    // The two that send or consume mail. /verify is the most expensive endpoint on the site by a wide
    // margin -- not in compute but in quota: every call spends one of Gmail's ~500 recipients a day, shared
    // with the digest. The route also enforces a two-minute cooldown per address, which is the limit that
    // matters; this one bounds how fast a single IP can work through a list of other people's addresses.
    "/api/reader/verify",
    "/api/reader/confirm",
  ],
  rateLimit: {
    windowLimit: 40,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
