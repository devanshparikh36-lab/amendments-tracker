import { NextRequest, NextResponse } from "next/server";

// Minimal shared-passcode gate. Set SITE_PASSCODE in the environment; leave it unset to disable the gate.
const COOKIE = "rt_auth";

async function expectedCookie(passcode: string): Promise<string> {
  const data = new TextEncoder().encode(`rt:${passcode}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(req: NextRequest) {
  const passcode = process.env.SITE_PASSCODE;
  if (!passcode) return NextResponse.next();
  const { pathname } = req.nextUrl;
  // /api/health is outside the gate on purpose: it is the warm-up ping, and a redirect to /login would keep
  // the function and the database asleep, which is the whole thing it exists to prevent. It returns no data
  // about the contents -- only whether the database answered, and how long it took.
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login") ||
    pathname === "/api/health" ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }
  const cookie = req.cookies.get(COOKIE)?.value;
  if (cookie && cookie === (await expectedCookie(passcode))) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
