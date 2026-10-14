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
 * This was null while the site held nothing about anybody, and the pages said so plainly rather than
 * carrying a placeholder that reads as real and silently discards what is sent to it. That was defensible
 * then. It stopped being defensible the day accounts shipped: a data fiduciary holding email addresses,
 * notes and saved searches has to publish somewhere to write for access, correction, erasure and
 * grievances, and "being set up" is not a contact.
 *
 * So this is a personal address rather than the dedicated one the original note argued for. The reasoning
 * there still stands -- this page is crawled and the address will be scraped -- and a dedicated account
 * remains the better answer. It is not the better answer than having no address at all while holding
 * personal data. Swap it for a dedicated one when it exists; it is one line and nothing else reads it.
 *
 * Not a work address, which was the one thing the original note ruled out outright: a personally-published
 * site must not route its grievances through an employer's domain.
 */
export const CONTACT_EMAIL: string | null = "devanshparikh36@gmail.com";

/** The date the current wording took effect. Bump it when the substance changes, not for a typo. */
export const LEGAL_UPDATED = "14 October 2026";

/* The processors. Named on the privacy page because a reader is entitled to know whose machines their
 * request passes through, and because two of the three are outside India -- which since accounts shipped
 * means a reader's own data, and not only statutory text and counts, leaves the country. */
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
    what: "Holds the statutory text, the amendment records, the search outcomes and the page counts described above. Also holds the accounts: the email addresses, names, follows, bookmarks, notes and saved searches of readers who have entered an address.",
  },
  {
    name: "Cloudflare R2",
    role: "File storage",
    where: "Global",
    what: "Holds the regulators' own PDFs. Serves them when a reader opens an official document.",
  },
] as const;
