/* Who publishes this site, and the facts the legal pages are written around.
 *
 * In one file because they appear on three pages and in the footer, and a privacy policy whose contact
 * address disagrees with the terms is worse than one with no address at all.
 */

/** Published by an individual, not by a firm. Nothing here is issued by or on behalf of any employer. */
export const PUBLISHER = "Devansh Parikh";

/** Gujarat, India. */
export const JURISDICTION = "Gujarat, India";

/* The address for privacy questions and grievances.
 *
 * Deliberately a dedicated account rather than a personal or a work one: it is published on a page that
 * crawlers read, and it will be scraped. A work address would also tie a personally-published site to an
 * employer's domain, which is the opposite of what publishing personally means.
 *
 * Until it exists this stays null and the pages say so in as many words. A placeholder address would be
 * worse than an admission -- it reads as a real contact and silently discards whatever is sent to it.
 */
export const CONTACT_EMAIL: string | null = null;

/** The date the current wording took effect. Bump it when the substance changes, not for a typo. */
export const LEGAL_UPDATED = "11 October 2026";

/* The processors. Named on the privacy page because a reader is entitled to know whose machines their
 * request passes through, and because two of the three are outside India. */
export const PROCESSORS = [
  {
    name: "Netlify",
    role: "Hosting and content delivery",
    where: "United States and its global edge network",
    what: "Serves every page. Receives the IP address and request headers of each visit, as any web server must, and may retain them briefly in operational logs.",
  },
  {
    name: "Neon",
    role: "Database",
    where: "Singapore (ap-southeast-1)",
    what: "Holds the statutory text, the amendment records, the search outcomes and the page counts described above. Holds nothing about any reader.",
  },
  {
    name: "Cloudflare R2",
    role: "File storage",
    where: "Global",
    what: "Holds the regulators' own PDFs. Serves them when a reader opens an official document.",
  },
] as const;
