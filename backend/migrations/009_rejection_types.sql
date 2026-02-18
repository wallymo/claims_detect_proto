ALTER TABLE claim_feedback ADD COLUMN rejection_type TEXT;
ALTER TABLE claim_feedback ADD COLUMN corrected_reference_id INTEGER REFERENCES reference_documents(id);
