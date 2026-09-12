import { NextResponse } from "next/server";
import { query } from "@/db";

export const dynamic = "force-dynamic";

// Keeps the slow parts awake, and answers "is it up?".
//
// Two things go cold and they compound: the Netlify function unloads after a quiet spell, and Neon's free
// plan suspends its compute after about five minutes idle. A first click that pays both, plus an empty cache,
// measured 5.4 seconds in production against 0.4-1.0 for every click after it.
//
// This has to sit outside the passcode gate, and it has to touch the database. A ping to any normal page is
// redirected to /login by the middleware before the page ever runs, so it would warm nothing -- which is the
// trap in "just curl the homepage". The query is deliberately the cheapest thing that still requires the
// database to be awake, and the response carries no data about what is in it.
export async function GET() {
  const started = Date.now();
  let db_ok = false;
  try {
    // ttl 0: a cached answer would defeat the entire purpose, since the point is to make a real connection.
    await query("SELECT 1 AS ok", [], 0);
    db_ok = true;
  } catch {
    db_ok = false;
  }
  return NextResponse.json(
    { ok: db_ok, db_ms: Date.now() - started },
    { status: db_ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
