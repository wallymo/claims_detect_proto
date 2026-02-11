CREATE TABLE IF NOT EXISTS reference_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_id INTEGER NOT NULL UNIQUE,
  facts_json TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  confirmed_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  model_used TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reference_id) REFERENCES reference_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reference_facts_reference_id ON reference_facts(reference_id);
CREATE INDEX IF NOT EXISTS idx_reference_facts_status ON reference_facts(extraction_status);
