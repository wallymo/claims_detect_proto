-- Annotation version snapshots
CREATE TABLE IF NOT EXISTS annotation_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_hash TEXT NOT NULL,
  brand_id INTEGER,
  version_number INTEGER NOT NULL,
  document_name TEXT NOT NULL,
  annotations_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ai',
  parent_version_id INTEGER,
  created_by TEXT DEFAULT 'reviewer',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_version_id) REFERENCES annotation_versions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_annotation_versions_document_hash ON annotation_versions(document_hash);
CREATE INDEX IF NOT EXISTS idx_annotation_versions_brand_id ON annotation_versions(brand_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_annotation_versions_hash_version ON annotation_versions(document_hash, version_number);

-- Individual edit audit trail
CREATE TABLE IF NOT EXISTS annotation_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL,
  annotation_id TEXT NOT NULL,
  edit_type TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (version_id) REFERENCES annotation_versions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_annotation_edits_version_id ON annotation_edits(version_id);

-- Brand-level learning patterns from reviewer corrections
CREATE TABLE IF NOT EXISTS brand_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL,
  pattern_type TEXT NOT NULL,
  pattern_json TEXT NOT NULL,
  strength INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_brand_patterns_brand_id ON brand_patterns(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_patterns_type ON brand_patterns(brand_id, pattern_type);

-- Document lineage for carry-forward of revised documents
CREATE TABLE IF NOT EXISTS document_lineage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_hash TEXT NOT NULL,
  parent_hash TEXT,
  brand_id INTEGER,
  similarity_score REAL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_document_lineage_hash ON document_lineage(document_hash);
CREATE INDEX IF NOT EXISTS idx_document_lineage_parent ON document_lineage(parent_hash);
