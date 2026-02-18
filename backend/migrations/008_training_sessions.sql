CREATE TABLE IF NOT EXISTS training_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  label TEXT DEFAULT '',
  document_name TEXT NOT NULL,
  approved_claims TEXT NOT NULL DEFAULT '[]',
  prompt_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  cleared_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_training_sessions_brand ON training_sessions(brand_id);
CREATE INDEX IF NOT EXISTS idx_training_sessions_cleared ON training_sessions(cleared_at);
