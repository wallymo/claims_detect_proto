CREATE TABLE IF NOT EXISTS analysis_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key TEXT NOT NULL UNIQUE,
  cache_version TEXT NOT NULL,
  brand_id INTEGER,
  file_sha256 TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_key TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  reference_fingerprint TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_size_bytes INTEGER NOT NULL DEFAULT 0,
  diagnostics_enabled INTEGER NOT NULL DEFAULT 0,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_cache_expires_at
ON analysis_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_analysis_cache_last_accessed
ON analysis_cache(last_accessed_at);

CREATE INDEX IF NOT EXISTS idx_analysis_cache_file_brand
ON analysis_cache(file_sha256, brand_id);
