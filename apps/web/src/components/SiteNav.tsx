"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Collection status is for whoever maintains the site, not for a reader looking up a section, so it is not
// in the main navigation. The footer still links it.
const NAV = [
  { href: "/", label: "Home" },
  { href: "/browse", label: "Acts & Rules" },
  { href: "/documents", label: "Notifications" },
];

export function SiteNav() {
  const path = usePathname() || "/";
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

  return (
    <nav aria-label="Sections" className="flex flex-wrap items-center gap-x-1 gap-y-1">
      {NAV.map((n) => {
        const on = active(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={on ? "page" : undefined}
            className={`rounded-t border-b-2 px-2.5 py-1.5 text-[13.5px] ${
              on
                ? "border-[var(--accent)] font-semibold text-[var(--ink)]"
                : "border-transparent text-[var(--ink-3)] hover:border-[var(--rule-strong)] hover:text-[var(--ink)]"
            }`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
