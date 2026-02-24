CREATE TABLE IF NOT EXISTS analysis_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER,
  document_name TEXT NOT NULL,
  model TEXT NOT NULL,
  training_example_count INTEGER DEFAULT 0,
  ecosystem_example_count INTEGER DEFAULT 0,
  claim_count INTEGER NOT NULL,
  matched_count INTEGER DEFAULT 0,
  avg_confidence REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
