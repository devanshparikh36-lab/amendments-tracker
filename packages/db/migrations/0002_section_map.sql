-- Official mapping between corresponding provisions of two instruments
-- (first use: CBDT's Income-tax Act 1961 / Rules 1962 <-> Income-tax Act 2025 / Rules 2026 table).

CREATE TABLE IF NOT EXISTS section_map (
  id              SERIAL PRIMARY KEY,
  map_key         TEXT NOT NULL,              -- e.g. 'income-tax'
  old_instrument  TEXT NOT NULL,              -- instrument slug, e.g. ita-1961
  new_instrument  TEXT NOT NULL,              -- e.g. ita-2025
  old_number      TEXT,                       -- '80C'  (NULL = no counterpart: dropped)
  old_title       TEXT,
  new_number      TEXT,                       -- '123'  (NULL = no counterpart: newly inserted)
  new_title       TEXT,
  entity_type     TEXT,                       -- section | rule | form (as published)
  sort_order      INT NOT NULL DEFAULT 0,
  source_url      TEXT,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS section_map_uniq
  ON section_map (map_key, coalesce(old_number, ''), coalesce(new_number, ''), coalesce(entity_type, ''));
CREATE INDEX IF NOT EXISTS section_map_old_idx ON section_map (map_key, old_number);
CREATE INDEX IF NOT EXISTS section_map_new_idx ON section_map (map_key, new_number);
