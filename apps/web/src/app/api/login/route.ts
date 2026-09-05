import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const passcode = String(form.get("passcode") ?? "");
  const next = String(form.get("next") ?? "/");
  const expected = process.env.SITE_PASSCODE ?? "";
  // Build redirects from the public host the browser used, not the internal URL a hosting platform may present.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;
  const target = new URL(next.startsWith("/") ? next : "/", origin);
  if (!expected || passcode !== expected) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", "1");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  }
  const res = NextResponse.redirect(target, 303);
  const value = createHash("sha256").update(`rt:${expected}`).digest("hex");
  res.cookies.set("rt_auth", value, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90, secure: process.env.NODE_ENV === "production" });
  return res;
}
