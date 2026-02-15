ALTER TABLE reference_documents ADD COLUMN deleted_at TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_refdocs_deleted_at ON reference_documents(deleted_at);
