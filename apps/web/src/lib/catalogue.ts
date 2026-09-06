// The five subjects a user actually thinks in, and the handful of instruments they open inside each.
// Slugs that are not in the database yet are simply skipped, so this list is safe to keep ahead of the seeder.

export type Subject = {
  key: string;
  name: string;
  blurb: string;
  regulators: string[];
  featured: string[];
  unit: string;
};

export const SUBJECTS: Subject[] = [
  {
    key: "income-tax",
    name: "Income Tax",
    blurb: "Income-tax Act and Rules, the 2025 Act, and CBDT notifications and circulars.",
    regulators: ["CBDT"],
    featured: ["ita-1961", "itr-1962", "ita-2025", "itr-2026"],
    unit: "section",
  },
  {
    key: "gst",
    name: "GST",
    blurb: "CGST, IGST, UTGST and Compensation Cess law with CBIC notifications and circulars.",
    regulators: ["CBIC"],
    featured: ["cgst-act-2017", "cgst-rules-2017", "igst-act-2017", "utgst-act-2017", "gst-compensation-act-2017"],
    unit: "section",
  },
  {
    key: "fema",
    name: "FEMA / Foreign Exchange",
    blurb: "RBI Master Directions and FEM Regulations, A.P. (DIR) circulars and gazette notifications.",
    regulators: ["RBI", "DEA"],
    featured: [
      "md-foreign-investment-in-india",
      "md-ecb",
      "md-lrs",
      "md-oi",
      "md-deposits-and-accounts",
      "md-export-goods-services",
      "md-import-goods-services",
      "md-establishment-of-branch-office-bo-liaison-office-lo-project-office-po-",
    ],
    unit: "paragraph",
  },
  {
    key: "sebi",
    name: "SEBI / Securities",
    blurb: "Listing, issue, takeover and insider-trading regulations with SEBI master circulars.",
    regulators: ["SEBI"],
    featured: [
      "sebi-lodr-2015",
      "sebi-icdr-2018",
      "sebi-pit-2015",
      "sebi-sast-2011",
      "sebi-buyback-2018",
      "sebi-delisting-2021",
      "sebi-aif-2012",
      "sebi-act-1992",
    ],
    unit: "regulation",
  },
  {
    key: "companies",
    name: "Companies Act",
    blurb: "Companies Act 2013 with the working Rules, MCA notifications and General Circulars.",
    regulators: ["MCA"],
    featured: [
      "companies-act-2013",
      "companies-incorporation-rules-2014",
      "companies-appointment-and-qualification-of-directors-rules-2014",
      "companies-meetings-of-board-and-its-powers-rules-2014",
      "companies-accounts-rules-2014",
      "companies-audit-and-auditors-rules-2014",
      "companies-share-capital-and-debentures-rules-2014",
      "companies-corporate-social-responsibility-policy-rules-2014",
    ],
    unit: "section",
  },
];

export const SUBJECT_BY_REGULATOR: Record<string, Subject> = Object.fromEntries(
  SUBJECTS.flatMap((s) => s.regulators.map((r) => [r, s] as const)),
);

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
