CREATE TABLE IF NOT EXISTS reference_passages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_id INTEGER NOT NULL,
  passage_index INTEGER NOT NULL,
  passage_text TEXT NOT NULL,
  start_char INTEGER,
  end_char INTEGER,
  page_estimate INTEGER,
  embedding BLOB,
  embedding_model TEXT DEFAULT 'gemini-embedding-001',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reference_id) REFERENCES reference_documents(id) ON DELETE CASCADE,
  UNIQUE(reference_id, passage_index)
);

CREATE INDEX IF NOT EXISTS idx_passages_reference_id ON reference_passages(reference_id);
CREATE INDEX IF NOT EXISTS idx_passages_embedding_model ON reference_passages(embedding_model);
