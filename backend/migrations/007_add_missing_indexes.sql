-- Add missing indexes identified in codebase audit
-- folder_id is filtered in reference queries but had no index
CREATE INDEX IF NOT EXISTS idx_reference_documents_folder_id ON reference_documents(folder_id);

-- document_id is filtered in feedback queries but had no index
CREATE INDEX IF NOT EXISTS idx_claim_feedback_document_id ON claim_feedback(document_id);
