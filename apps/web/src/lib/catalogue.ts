// The five subjects a user actually thinks in, and the handful of instruments they open inside each.
// Slugs that are not in the database yet are simply skipped, so this list is safe to keep ahead of the seeder.

export type Subject = {
  key: string;
  name: string;
  blurb: string;
  regulators: string[];
  unit: string;
  // The handful of entry points a reader actually opens. Slugs absent from the database are skipped,
  // so this list is safe to keep ahead of the seeder. Everything else stays one quiet link away.
  featured: string[];
  // SEBI publishes about a hundred regulations; only its master circulars belong on a front page.
  featuredPrefix?: string;
  featuredPrefixHeading?: string;
  featuredPrefixLimit?: number;
  // Companies work starts from a search box and the last few MCA circulars, not from a list of rules.
  search?: string;
  recentDocuments?: number;
  // The 1961 to 2025 concordance is an income-tax tool, so it is offered only where income tax is.
  compare?: boolean;
};

// The concordance is not a site-wide feature: it is linked from the Income Tax block and from the
// two Acts it maps, and nowhere else.
export const COMPARE_HREF = "/compare/income-tax";
export const COMPARE_SLUGS: Record<string, string> = {
  "ita-1961": "Compare with the Income-tax Act, 2025",
  "ita-2025": "Compare with the Income-tax Act, 1961",
};

export const SUBJECTS: Subject[] = [
  {
    key: "income-tax",
    name: "Income Tax",
    blurb: "The two Acts and the Rules made under them.",
    regulators: ["CBDT"],
    unit: "section",
    featured: ["ita-2025", "ita-1961", "itr-2026", "itr-1962"],
    compare: true,
  },
  {
    key: "gst",
    name: "GST",
    blurb: "The central and integrated levies with the working Rules.",
    regulators: ["CBIC"],
    unit: "section",
    featured: ["cgst-act-2017", "cgst-rules-2017", "igst-act-2017", "gst-compensation-act-2017"],
  },
  {
    key: "companies",
    name: "Companies Act",
    blurb: "The Act itself, and what MCA has issued lately.",
    regulators: ["MCA"],
    unit: "section",
    featured: ["companies-act-2013"],
    search: "section 185, CSR, incorporation",
    recentDocuments: 5,
  },
  {
    key: "sebi",
    name: "SEBI / Securities",
    blurb: "Listing obligations, and SEBI's consolidated master circulars.",
    regulators: ["SEBI"],
    unit: "regulation",
    featured: ["sebi-lodr-2015"],
    featuredPrefix: "sebi-mc-",
    featuredPrefixHeading: "Master circulars",
    featuredPrefixLimit: 5,
  },
  {
    key: "fema",
    name: "FEMA / Foreign Exchange",
    blurb: "The RBI Master Directions in daily use.",
    regulators: ["RBI", "DEA"],
    unit: "paragraph",
    featured: [
      "md-foreign-investment-in-india",
      "md-ecb",
      "md-lrs",
      "md-oi",
      "md-overseas-investment",
      "md-deposits-and-accounts",
    ],
  },
];

export const SUBJECT_BY_REGULATOR: Record<string, Subject> = Object.fromEntries(
  SUBJECTS.flatMap((s) => s.regulators.map((r) => [r, s] as const)),
);

/* Instruments the regulator has replaced, and what replaced them.
 *
 * Curated by hand, deliberately. Supersession is a legal fact, not something to infer: titles are the only
 * signal in the data and they lie in both directions. "FEM (Export of Goods & Services) Regulations, 2015"
 * and "FEM (Export and Import of Goods and Services) Regulations, 2026" are plainly related and share almost
 * no words, while the Income-tax Acts of 1961 and 2025 look exactly like a replacement pair and are not one
 * -- the 1961 Act governs earlier years and the 2025 Act applies from 1 April 2026, so both are live and
 * hiding either would be wrong. The whole comparison tool exists because both matter.
 *
 * So entries are added only where supersession is established, never where it merely looks likely. A missing
 * entry shows a reader one instrument too many, which is recoverable; a wrong entry hides the law that
 * applies to them, which is not.
 *
 * Several FEMA regulations from 2000 are very likely superseded -- the Deposit Regulations 2000 by those of
 * 2016, TISPRO 2000 by the Non-Debt Instruments Rules 2019 -- but "likely" is not the standard here. Add
 * them once someone who knows has confirmed each one.
 */
export const SUPERSEDED_BY: Record<string, string> = {
  // instruments.py records this directly: SEBI recast the 1996 Regulations as the current ones and its Legal
  // listing now carries only the latter.
  "sebi-mutual-funds-1996": "sebi-mutual-funds",

  // The FEMA entries below were each confirmed by the firm on 10 Oct 2026, not inferred from their titles.
  // Export went through three generations and the names do not line up with each other at all -- "Export of
  // goods and services" (2000), "Export of Goods & Services" (2015), "Export and Import of Goods and
  // Services" (2026) -- which is exactly why no rule could have derived this.
  "fem-export-of-goods-and-services-regulations-2000": "fem-export-and-import-of-goods-and-services-regulations-2026",
  "fem-export-of-goods-services-regulations-2015": "fem-export-and-import-of-goods-and-services-regulations-2026",
  "fem-borrowing-or-lending-in-foreign-exchange-regulations-2000": "fem-borrowing-and-lending-regulations-2018",
  "fem-manner-of-receipt-payment-regulations-2000": "fem-manner-of-receipt-and-payment-regulations-2023",

  // Not inferred either, but established from SEBI's own listing rather than from the titles: a full pass
  // over SEBI's Legal > Regulations listing (1,138 entries) carries the Foreign Portfolio Investors
  // Regulations 2019 and no Foreign Institutional Investors Regulations 1995 at all. The 1995 regulations
  // were repealed and recast -- FII 1995 to FPI 2014 to FPI 2019 -- so there is no SEBI page left to read,
  // which is also why that instrument's self-check could never succeed.
  //
  // Pointed at `sebi-foreign-portfolio-investors-regulations-2019` and not `sebi-fpi-2019`: both exist, and
  // the former is the one that holds anything (SEBI's official PDF, 37 pages). The latter is an empty
  // duplicate registered from the listing and is worth cleaning up separately.
  "sebi-foreign-institutional-investors-1995": "sebi-foreign-portfolio-investors-regulations-2019",
};

export function supersededBy(slug: string): string | null {
  return SUPERSEDED_BY[slug] ?? null;
}

/* The Act a set of Rules is made under.
 *
 * Needed because Rules have no sections. When the Income-tax Rules say "referred to in section 139", they
 * mean section 139 of the Income-tax Act -- the citation names no instrument precisely because, to a reader
 * who knows the context, it does not need to. A cross-reference linker without this either refuses every
 * such citation, which is most of them, or links them to a section of the Rules that does not exist.
 *
 * Curated like the supersession list, and for the same reason: the relationship is a legal one. Rules made
 * under the Companies Act all point at it; the GST Rules point at the CGST Act even where the text being
 * read is the IGST Rules, because that is where the sections live.
 */
export const PARENT_ACT: Record<string, string> = {
  "itr-1962": "ita-1961",
  "itr-2026": "ita-2025",
  "cgst-rules-2017": "cgst-act-2017",
  "igst-rules-2017": "igst-act-2017",
  "companies-incorporation-rules-2014": "companies-act-2013",
  "companies-management-and-administration-rules-2014": "companies-act-2013",
  "companies-registered-valuers-and-valuation-rules-2017": "companies-act-2013",
  "companies-share-capital-and-debentures-rules-2014": "companies-act-2013",
  "companies-appointment-and-qualification-of-directors-rules-2014": "companies-act-2013",
  "companies-prospectus-and-allotment-of-securities-rules-2014": "companies-act-2013",
  "companies-accounts-rules-2014": "companies-act-2013",
  "companies-meetings-of-board-and-its-powers-rules-2014": "companies-act-2013",
  "companies-audit-and-auditors-rules-2014": "companies-act-2013",
  "companies-corporate-social-responsibility-policy-rules-2014": "companies-act-2013",
  // Every FEM regulation is made under the Foreign Exchange Management Act, so "section 6 of the Act"
  // inside one means section 6 of FEMA. Worth adding only now that the Act has a text at all: until
  // today it held none, and a link into an empty instrument is a worse answer than no link. The Act
  // is served as a PDF, so these open the official file with the citation already searched.
  "fem-acquisition-and-transfer-of-immovable-property-in-india-regulations-2000": "fema-1999",
  "fem-acquisition-and-transfer-of-immovable-property-outside-india-regulations-200": "fema-1999",
  "fem-borrowing-and-lending-in-rupees-regulations-2000": "fema-1999",
  "fem-borrowing-and-lending-regulations-2018": "fema-1999",
  "fem-borrowing-or-lending-in-foreign-exchange-regulations-2000": "fema-1999",
  "fem-cross-border-merger-regulations-2018": "fema-1999",
  "fem-crystallization-of-inoperative-foreign-currency-deposits-regulations-2014": "fema-1999",
  "fem-debt-instruments-regulations-2019": "fema-1999",
  "fem-deposit-regulations-2016": "fema-1999",
  "fem-establishment-in-india-of-a-branch-office-or-a-liaison-office-or-a-project-o": "fema-1999",
  "fem-establishment-in-india-of-branch-or-office-or-other-place-of-business-regula": "fema-1999",
  "fem-export-and-import-of-currency-regulations-2015": "fema-1999",
  "fem-export-and-import-of-goods-and-services-regulations-2026": "fema-1999",
  "fem-export-of-goods-and-services-regulations-2000": "fema-1999",
  "fem-export-of-goods-services-regulations-2015": "fema-1999",
  "fem-foreign-exchange-derivative-contracts-regulations-2000": "fema-1999",
  "fem-guarantees-regulations-2026": "fema-1999",
  "fem-insurance-regulations-2000": "fema-1999",
  "fem-international-financial-services-centre-regulations-2015": "fema-1999",
  "fem-investment-in-firm-or-proprietary-concern-in-india-regulations-2000": "fema-1999",
  "fem-issue-of-security-in-india-by-a-branch-office-or-agency-of-a-person-resident": "fema-1999",
  "fem-manner-of-receipt-and-payment-regulations-2023": "fema-1999",
  "fem-manner-of-receipt-payment-regulations-2000": "fema-1999",
  "fem-margin-for-derivative-contracts-regulations-2020": "fema-1999",
  "fem-mode-of-payment-and-reporting-of-non-debt-instruments-regulations-2019": "fema-1999",
  "fem-overseas-investment-regulations-2022": "fema-1999",
  "fem-permissible-capital-account-transactions-regulations-2000": "fema-1999",
  "fem-possession-and-retention-of-foreign-currency-regulations-2000": "fema-1999",
  "fem-realisation-repatriation-and-surrender-of-foreign-exchange-regulations-2000": "fema-1999",
  "fem-regularization-of-assets-held-abroad-by-a-person-resident-in-india-regulatio": "fema-1999",
  "fem-remittance-of-assets-regulations-2000": "fema-1999",
  "fem-transfer-or-issue-of-any-foreign-security-regulations-2000": "fema-1999",
};

// The two headed groups an instrument can fall into on a listing. Master Directions and Master Circulars sit
// with Rules and Regulations: a reader looking for "the working rules" wants them in the same place, not
// under a heading that says Acts.
export function instrumentGroup(kind: string): "acts" | "rules" {
  return kind === "act" ? "acts" : "rules";
}

export const GROUP_HEADING: Record<"acts" | "rules", string> = {
  acts: "Acts",
  rules: "Rules & Regulations",
};

// The subject's own accent, as a class the stylesheet turns into a 3px left rule.
export function subjectClass(key: string): string {
  return `sub-${key}`;
}

// What one numbered item of this instrument is called, for headings and counts.
export function unitFor(kind: string): string {
  if (kind === "rules") return "rule";
  if (kind === "regulations") return "regulation";
  if (kind === "master_direction" || kind === "master_circular") return "paragraph";
  return "section";
}

export function unitPlural(kind: string): string {
  return `${unitFor(kind)}s`;
}

// Cards and lists show many instruments from one family; drop the boilerplate prefix so the
// distinguishing words are what the eye lands on.
export function shortTitle(title: string): string {
  return title
    .replace(/^Securities and Exchange Board of India\s*/i, "SEBI ")
    .replace(/^Foreign Exchange Management\s*/i, "FEM ")
    .replace(/^Master Direction\s*[–—-]\s*/i, "")
    .replace(/^The\s+/i, "")
    .trim();
}

export const REGULATOR_LABEL: Record<string, string> = {
  RBI: "Reserve Bank of India",
  DEA: "Ministry of Finance (DEA)",
  CBDT: "CBDT — Income Tax",
  CBIC: "CBIC — GST",
  SEBI: "SEBI",
  MCA: "MCA — Companies Act",
};

export const KIND_LABEL: Record<string, string> = {
  act: "Act",
  rules: "Rules",
  regulations: "Regulations",
  master_direction: "Master Direction",
  master_circular: "Master Circular",
  scheme: "Scheme",
  other: "Other",
};

// Short names people type. Longest keys are matched first, so "income tax rules" beats "income tax".
export const INSTRUMENT_ALIASES: Record<string, string> = {
  "income tax act": "ita-1961",
  "income-tax act": "ita-1961",
  "it act": "ita-1961",
  ita: "ita-1961",
  "1961": "ita-1961",
  "income tax rules": "itr-1962",
  "income-tax rules": "itr-1962",
  itr: "itr-1962",
  "1962": "itr-1962",
  "2025 act": "ita-2025",
  "new income tax act": "ita-2025",
  "2026 rules": "itr-2026",
  cgst: "cgst-act-2017",
  "cgst act": "cgst-act-2017",
  "gst act": "cgst-act-2017",
  "cgst rules": "cgst-rules-2017",
  "gst rules": "cgst-rules-2017",
  igst: "igst-act-2017",
  utgst: "utgst-act-2017",
  lodr: "sebi-lodr-2015",
  listing: "sebi-lodr-2015",
  icdr: "sebi-icdr-2018",
  pit: "sebi-pit-2015",
  insider: "sebi-pit-2015",
  "insider trading": "sebi-pit-2015",
  sast: "sebi-sast-2011",
  takeover: "sebi-sast-2011",
  takeovers: "sebi-sast-2011",
  buyback: "sebi-buyback-2018",
  "buy-back": "sebi-buyback-2018",
  delisting: "sebi-delisting-2021",
  aif: "sebi-aif-2012",
  pms: "sebi-portfolio-managers-2020",
  "portfolio managers": "sebi-portfolio-managers-2020",
  "mutual funds": "sebi-mutual-funds",
  scra: "scra-1956",
  "sebi act": "sebi-act-1992",
  "companies act": "companies-act-2013",
  "2013": "companies-act-2013",
  ca13: "companies-act-2013",
  incorporation: "companies-incorporation-rules-2014",
  "incorporation rules": "companies-incorporation-rules-2014",
  directors: "companies-appointment-and-qualification-of-directors-rules-2014",
  "board meetings": "companies-meetings-of-board-and-its-powers-rules-2014",
  csr: "companies-corporate-social-responsibility-policy-rules-2014",
  "share capital": "companies-share-capital-and-debentures-rules-2014",
  auditors: "companies-audit-and-auditors-rules-2014",
  ecb: "md-ecb",
  "external commercial": "md-ecb",
  lrs: "md-lrs",
  "liberalised remittance": "md-lrs",
  odi: "md-oi",
  "overseas investment": "md-oi",
  fdi: "md-foreign-investment-in-india",
  "foreign investment": "md-foreign-investment-in-india",
};
