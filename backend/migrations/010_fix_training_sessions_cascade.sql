-- Recreate training_sessions with ON DELETE CASCADE so brand deletion works
-- Uses rename-copy-drop pattern (SQLite does not support ALTER FOREIGN KEY)
PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS training_sessions_new;
CREATE TABLE training_sessions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  label TEXT DEFAULT '',
  document_name TEXT NOT NULL,
  approved_claims TEXT NOT NULL DEFAULT '[]',
  prompt_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  cleared_at DATETIME
);
INSERT INTO training_sessions_new SELECT * FROM training_sessions;
DROP TABLE training_sessions;
ALTER TABLE training_sessions_new RENAME TO training_sessions;
CREATE INDEX IF NOT EXISTS idx_training_sessions_brand ON training_sessions(brand_id);
CREATE INDEX IF NOT EXISTS idx_training_sessions_cleared ON training_sessions(cleared_at);
PRAGMA foreign_keys = ON;
