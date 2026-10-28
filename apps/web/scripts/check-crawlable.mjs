/* Fail the build if a page that costs a function on every hit is open to crawlers.
 *
 * This exists because the same mistake has now been made twice, four days apart, and both times it was
 * expensive and both times it looked fine on inspection.
 *
 * 21 Oct: `Disallow: /browse/*?*` was removed on the reasoning that the only query-string addresses left
 * were "reachable only from a form, not linked, not in the sitemap". The whole-Act view was linked from a
 * button on all 196 instrument pages and is the most expensive render on the site. Compute went from 27
 * credits to 105.6 in a day, out of 300, and the account was emptied.
 *
 * 25 Oct: /browse was blocked outright, and the filtered document list was not. Those pages link to each
 * other combinatorially -- by instrument, by subject, by regulator, by page -- so a crawler walks the
 * product of all of them, rendering each. 29,601 requests, 10.7 GB-hours, 107 credits in three days.
 *
 * The common thread is not carelessness about the page being changed. It is that neither time did anyone
 * ask what ELSE had the same shape. A human checking the thing they just edited will keep missing the one
 * they did not. So the question is asked here, mechanically, on every build.
 *
 * What counts as uncached: a route Next did not prerender, which is every route that reads searchParams,
 * cookies or headers. Read from .next/prerender-manifest.json rather than guessed, so the answer is
 * whatever Next actually decided rather than what the source looks like it should mean.
 *
 * What counts as protected: a Disallow in robots.ts covering either the path itself or the path with a
 * query string. Both are acceptable and the difference is deliberate -- blocking the filtered list closes
 * an unbounded space while leaving the 8,044 cached document pages crawlable, which is the outcome worth
 * having. A bare dynamic path with no parameters is one URL and one render, which is survivable.
 *
 * To silence it for a route, either make the route cacheable or add the Disallow. Do not add an exception
 * here. A list of things this check is allowed to ignore would have grown to contain both of the routes
 * above long before they cost anything.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(web, p), "utf8"));

/* Routes that are nobody's crawl surface. /api is machine plumbing and is disallowed wholesale already;
 * the consoles sit behind ADMIN_KEY; _not-found is not a URL. Named rather than pattern-matched so that
 * adding one is a visible decision. */
const NOT_A_PAGE = [/^\/api\//, /^\/_not-found/, /^\/admin/, /^\/status/, /^\/quality/, /^\/you/];

const routes = Object.values(read(".next/app-path-routes-manifest.json"));
const prerender = read(".next/prerender-manifest.json");

const cached = new Set(Object.keys(prerender.routes ?? {}));
const cachedPatterns = Object.keys(prerender.dynamicRoutes ?? {});

/* robots.ts is the source of truth and is parsed rather than imported: importing it would mean compiling
 * TypeScript here, and the file is a literal array of strings.
 *
 * Comments are stripped first, and that is not a tidiness measure. Without it the quoted strings inside
 * robots.ts's own comments are read as rules. On the first run this harvested "Read full text", a sentence
 * fragment, and -- fatally -- a bare "/" from a comment, which as a prefix rule matches every route on the
 * site. The check then reported success with the real rules deleted. A guard that cannot fail is worse
 * than no guard, because it is also believed.
 */
const robotsSrc = readFileSync(join(web, "src/app/robots.ts"), "utf8");

/* robots.ts is parsed rather than imported, because importing it would mean compiling TypeScript here.
 *
 * Read line by line, taking only lines that are nothing but a quoted string. Two earlier attempts failed
 * and both failed silently, which is the point of the assertion below.
 *
 * The first matched every quoted string in the file, so prose inside robots.ts's own comments became
 * rules -- including a bare "/" lifted from a sentence, which as a prefix matches every route and made
 * this check report success with the real rules deleted.
 *
 * The second stripped comments first with a regex, which broke on the rules themselves: "/browse/*?*"
 * contains the characters that open a block comment, so the stripper ate from there to the next "*\/"
 * and took half the array with it.
 *
 * A rule line has a shape no comment line has -- optional whitespace, a quoted string, an optional comma,
 * end of line -- so that shape is what is matched. A comment line begins with * or /, and prose with a
 * quotation in it is not alone on its line.
 */
const RULE_LINE = /^\s*"([^"]+)",?\s*$/;
const lines = robotsSrc.split("\n");
const open = lines.findIndex((l) => /disallow:\s*\[/.test(l));
if (open === -1) {
  console.error("check-crawlable: could not find the disallow array in robots.ts");
  process.exit(1);
}
const disallows = [];
for (let i = open + 1; i < lines.length; i += 1) {
  if (/^\s*\],?\s*$/.test(lines[i])) break;
  const m = lines[i].match(RULE_LINE);
  if (m) disallows.push(m[1]);
}

/* Every rule must be a path. Prose is not, and both parser bugs above produced rules that fail this, so
 * this is the assertion that turns a silent misread into a loud one. */
const bad = disallows.filter((d) => !d.startsWith("/") || /\s/.test(d));

/* A bare "/" blocks the whole site, which is a real and sometimes correct answer -- it is what is in force
 * now, while credits are short. But it is also the single value that would make this check pass vacuously
 * if the parser ever went wrong again, because as a prefix it matches every route.
 *
 * Telling the two apart: a deliberate "/" is the ONLY rule, because nothing else is needed once everything
 * is blocked. A "/" harvested by mistake would appear alongside the real rules. So "/" with company is
 * refused and "/" alone is accepted. */
if (disallows.includes("/") && disallows.length > 1) {
  console.error('check-crawlable: robots.ts has a bare "/" alongside other rules, which is how a misread looks.');
  console.error("  rules read: " + disallows.map((d) => JSON.stringify(d)).join(" "));
  process.exit(1);
}
if (bad.length) {
  console.error("check-crawlable: robots.ts produced rules that are not paths, so the rules were misread:");
  for (const b of bad) console.error(`  ${JSON.stringify(b)}`);
  process.exit(1);
}
if (disallows.length === 0) {
  console.error("check-crawlable: robots.ts lists no Disallow rules at all");
  process.exit(1);
}

const isCached = (route) =>
  cached.has(route) || cachedPatterns.includes(route) || route.includes("[");

/* A Disallow is a prefix match, and "*" may stand in the middle of one. Turning it into a regex keeps
 * a rule like "/browse/*?*" working, which a plain startsWith would not. */
const covers = (rule, route) => {
  const rx = new RegExp(
    "^" + rule.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*"),
  );
  return rx.test(route) || rx.test(route + "?");
};

const exposed = routes
  .filter((r) => !NOT_A_PAGE.some((rx) => rx.test(r)))
  .filter((r) => !isCached(r))
  .filter((r) => !disallows.some((d) => covers(d, r)));

if (exposed.length) {
  console.error("");
  console.error("::error::These pages run a function on every request and nothing stops a crawler walking them:");
  for (const r of exposed) console.error(`::error::  ${r}`);
  console.error("");
  console.error("Each is uncached because it reads searchParams, cookies or headers, so every crawl of every");
  console.error("combination of its parameters is a fresh render. That is what emptied the account twice.");
  console.error("");
  console.error("Fix it one of two ways, in src/app/robots.ts or in the page:");
  console.error("  - add a Disallow for its query strings, keeping any cached pages below it open");
  console.error("  - or stop the page reading searchParams so Next can prerender it");
  process.exit(1);
}

console.log(`check-crawlable: ${routes.length} routes, none uncached and crawlable`);
