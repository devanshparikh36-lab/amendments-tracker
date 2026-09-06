// Drizzle mirror of packages/db/migrations/*.sql (the SQL files are the source of truth; the worker applies them).
import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const regulator = pgTable("regulator", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  website: text("website"),
});

export const instrument = pgTable("instrument", {
  id: serial("id").primaryKey(),
  regulatorId: integer("regulator_id").notNull(),
  slug: text("slug").notNull(),
  shortCode: text("short_code").notNull(),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  officialUrl: text("official_url"),
  officialUpdatedAsOn: date("official_updated_as_on"),
  pdfStorageKey: text("pdf_storage_key"),
  pdfSourceUrl: text("pdf_source_url"),
  pdfPageCount: integer("pdf_page_count"),
  pdfFetchedAt: timestamp("pdf_fetched_at", { withTimezone: true }),
  seededAt: timestamp("seeded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const provision = pgTable("provision", {
  id: serial("id").primaryKey(),
  instrumentId: integer("instrument_id").notNull(),
  parentId: integer("parent_id"),
  number: text("number").notNull(),
  heading: text("heading"),
  level: text("level").notNull(),
  sortKey: integer("sort_key").notNull(),
  pdfStorageKey: text("pdf_storage_key"),
  pdfPage: integer("pdf_page"),
  sourceUrl: text("source_url"),
});

export const provisionVersion = pgTable("provision_version", {
  id: serial("id").primaryKey(),
  provisionId: integer("provision_id").notNull(),
  text: text("text").notNull(),
  html: text("html"),
  effectiveFrom: date("effective_from"),
  effectiveTo: date("effective_to"),
  sourceKind: text("source_kind").notNull(),
  createdByDocumentId: integer("created_by_document_id"),
  mergeConfidence: real("merge_confidence"),
  footnote: text("footnote"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const document = pgTable("document", {
  id: serial("id").primaryKey(),
  regulatorId: integer("regulator_id").notNull(),
  sourceAdapter: text("source_adapter").notNull(),
  docType: text("doc_type").notNull(),
  number: text("number"),
  title: text("title").notNull(),
  dateIssued: date("date_issued"),
  dateEffective: date("date_effective"),
  sourceUrl: text("source_url").notNull(),
  rawHtml: text("raw_html"),
  extractedText: text("extracted_text"),
  checksum: text("checksum"),
  isAmending: boolean("is_amending"),
  tagStatus: text("tag_status").notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
});

export const attachment = pgTable("attachment", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  filename: text("filename").notNull(),
  mime: text("mime"),
  sourceUrl: text("source_url").notNull(),
  storageKey: text("storage_key"),
  sizeBytes: integer("size_bytes"),
  pageCount: integer("page_count"),
  extractedText: text("extracted_text"),
  ocrUsed: boolean("ocr_used").notNull(),
  isPrimary: boolean("is_primary").notNull(),
  checksum: text("checksum"),
});

export const documentTag = pgTable("document_tag", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  instrumentId: integer("instrument_id").notNull(),
  provisionId: integer("provision_id"),
  relation: text("relation").notNull(),
  confidence: real("confidence"),
});

export const amendmentEffect = pgTable("amendment_effect", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  provisionId: integer("provision_id").notNull(),
  changeType: text("change_type").notNull(),
  oldVersionId: integer("old_version_id"),
  newVersionId: integer("new_version_id"),
  confidence: real("confidence"),
  aiNote: text("ai_note"),
  verificationStatus: text("verification_status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const sourceRun = pgTable("source_run", {
  id: serial("id").primaryKey(),
  adapter: text("adapter").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  docsFound: integer("docs_found").notNull(),
  docsNew: integer("docs_new").notNull(),
  ok: boolean("ok"),
  error: text("error"),
});

export const job = pgTable("job", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
