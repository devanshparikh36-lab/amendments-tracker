import Link from "next/link";
import { SearchBox } from "@/components/SearchBox";

export const metadata = { title: "Page not found" };

/* The 404 a reader actually hits.
 *
 * Until this existed the site served Next's stock screen -- "404: This page could not be found." in black on
 * white, with no masthead, no navigation and no way onward. It also looked like a different website, because
 * it is one: the stock page is rendered outside this app's styling entirely.
 *
 * The commonest way to arrive here is a mistyped or stale section URL -- `/browse/ita-1961/text?p=80CCD(1B)`
 * copied out of an email with the bracket mangled, or an instrument slug that has since been renamed. So the
 * page leads with the search box rather than an apology: the thing the reader wanted is almost always on the
 * site, one query away.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl py-6">
      <div className="panel p-8">
        <p className="eyebrow">404</p>
        <h1 className="serif mt-1 text-[22px] font-semibold text-[var(--ink)]">
          There is nothing at that address
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--ink-2)]">
          The link may be mistyped, or it may point at a section number or an instrument that this site files
          under a different name. Searching finds it more reliably than guessing the URL.
        </p>

        <form action="/find" className="mt-5 flex gap-2">
          <SearchBox placeholder="A section number, a regulation, an Act" />
          <button type="submit" className="btn btn-primary shrink-0">
            Search
          </button>
        </form>

        <div className="mt-6 border-t border-[var(--rule)] pt-4">
          <p className="eyebrow">Or start from</p>
          <ul className="mt-2 grid gap-1.5 text-[13.5px] sm:grid-cols-2">
            <li>
              <Link href="/browse" className="text-[var(--link)] hover:underline">
                Acts, Rules and Regulations
              </Link>
            </li>
            <li>
              <Link href="/documents" className="text-[var(--link)] hover:underline">
                Notifications and circulars
              </Link>
            </li>
            <li>
              <Link href="/definitions" className="text-[var(--link)] hover:underline">
                Search definitions
              </Link>
            </li>
            <li>
              <Link href="/about" className="text-[var(--link)] hover:underline">
                About this site
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
