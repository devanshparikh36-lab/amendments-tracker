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
 * A dedicated account, which is what the first version of this note argued for and could not have: it was
 * null while the site held nothing about anybody, and the pages said so plainly rather than carrying a
 * placeholder that reads as real and silently discards what is sent to it. That stopped being defensible
 * the day accounts shipped, since access, correction, erasure and grievances all need a destination.
 *
 * It is also the account the digest is sent from, so one address is the sender, the reply-to and the
 * published contact. Fewer things to keep in step, and a reply to the digest reaches a mailbox somebody
 * reads.
 *
 * It will be scraped -- this page is crawled, and that was always the cost of publishing one. Accepted,
 * because the alternative is holding personal data with nowhere to write about it.
 *
 * Not a work address, which the original note ruled out outright: a personally-published site must not
 * route its grievances through an employer domain.
 */
export const CONTACT_EMAIL: string | null = "as.amended321@gmail.com";

/** The date the current wording took effect. Bump it when the substance changes, not for a typo. */
export const LEGAL_UPDATED = "15 October 2026";

/* The processors. Named on the privacy page because a reader is entitled to know whose machines their
 * request passes through, and because every one of them is outside India -- which since accounts shipped
 * means a reader's own data, and not only statutory text and counts, leaves the country.
 *
 * Google joined the list on 15 October 2026, when the site began sending mail to readers. A service that
 * carries a message necessarily handles the address it goes to, so it processes personal data and belongs
 * here. Leaving it off because "we only use it for sending" is the commonest way these lists go stale. */
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
  {
    name: "Google (Gmail)",
    role: "Sending email",
    where: "Global",
    what: "Carries the two messages this site sends: the note that verifies an address, and the daily digest to readers who have confirmed one. Handling those means handling the address they are sent to. It is not used for anything else, and a reader who never asks for email never has an address pass through it.",
  },
] as const;
