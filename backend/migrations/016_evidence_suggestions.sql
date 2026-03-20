-- Evidence suggestion pipeline: AI-suggested evidence regions from source PDFs
CREATE TABLE IF NOT EXISTS evidence_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suggestion_id TEXT UNIQUE NOT NULL,
  claim_id TEXT NOT NULL,
  reference_id INTEGER NOT NULL,
  page_number INTEGER NOT NULL,
  type TEXT NOT NULL,
  rects JSON NOT NULL,
  text TEXT,
  score REAL NOT NULL,
  support_strength TEXT NOT NULL,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'suggested',
  origin TEXT NOT NULL DEFAULT 'rules_plus_ai',
  raw_shortlist JSON,
  raw_gemini_response JSON,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (reference_id) REFERENCES reference_documents(id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_suggestions_claim_ref
  ON evidence_suggestions(claim_id, reference_id);

-- Accepted evidence: persisted red boxes from accepted suggestions + manual user draws
CREATE TABLE IF NOT EXISTS accepted_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_id TEXT UNIQUE NOT NULL,
  claim_id TEXT NOT NULL,
  reference_id INTEGER NOT NULL,
  page_number INTEGER NOT NULL,
  type TEXT NOT NULL,
  rects JSON NOT NULL,
  text TEXT,
  origin TEXT NOT NULL,
  suggestion_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (reference_id) REFERENCES reference_documents(id)
);

CREATE INDEX IF NOT EXISTS idx_accepted_evidence_claim_ref
  ON accepted_evidence(claim_id, reference_id);
