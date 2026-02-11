CREATE TABLE IF NOT EXISTS brands (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  client      TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_brands_client ON brands(client);

CREATE TABLE IF NOT EXISTS reference_documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id        INTEGER NOT NULL,
  filename        TEXT    NOT NULL,
  display_alias   TEXT    NOT NULL,
  file_path       TEXT    NOT NULL,
  doc_type        TEXT    NOT NULL DEFAULT 'pdf',
  content_text    TEXT,
  notes           TEXT    DEFAULT '',
  page_count      INTEGER,
  file_size_bytes INTEGER NOT NULL DEFAULT 0,
  upload_date     TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_refdocs_brand ON reference_documents(brand_id);
CREATE INDEX IF NOT EXISTS idx_refdocs_type  ON reference_documents(doc_type);

CREATE TABLE IF NOT EXISTS claim_feedback (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id          TEXT    NOT NULL,
  document_id       TEXT,
  reference_doc_id  INTEGER,
  decision          TEXT    NOT NULL DEFAULT 'pending',
  modified_text     TEXT,
  reason            TEXT    DEFAULT '',
  confidence_score  REAL,
  reviewer_notes    TEXT    DEFAULT '',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (reference_doc_id) REFERENCES reference_documents(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_claim    ON claim_feedback(claim_id);
CREATE INDEX IF NOT EXISTS idx_feedback_decision ON claim_feedback(decision);
