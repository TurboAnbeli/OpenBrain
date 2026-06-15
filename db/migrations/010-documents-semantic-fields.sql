-- Migration 010: semantic document fields and chunk kinds for one-brain documents
--
-- Brings checked-in migrations up to the live schema already expected by the
-- importer and API. Keeps this drift-fix scoped to document tables only.

BEGIN;

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS bank_id TEXT;
UPDATE documents SET bank_id = 'openbrain' WHERE bank_id IS NULL;
ALTER TABLE documents
    ALTER COLUMN bank_id SET DEFAULT 'openbrain';
ALTER TABLE documents
    ALTER COLUMN bank_id SET NOT NULL;

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS document_kind TEXT;
UPDATE documents SET document_kind = 'article' WHERE document_kind IS NULL;
ALTER TABLE documents
    ALTER COLUMN document_kind SET DEFAULT 'article';
ALTER TABLE documents
    ALTER COLUMN document_kind SET NOT NULL;

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS session_id TEXT;

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS task_id TEXT;

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS intent TEXT;

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS event_started_at TIMESTAMPTZ;

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS event_ended_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'documents_document_kind_check'
    ) THEN
        ALTER TABLE documents
            ADD CONSTRAINT documents_document_kind_check CHECK (
                document_kind IN (
                    'article',
                    'handoff',
                    'decision',
                    'reflection',
                    'research',
                    'postmortem',
                    'reference',
                    'project_note',
                    'journal',
                    'clipping'
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'documents_intent_check'
    ) THEN
        ALTER TABLE documents
            ADD CONSTRAINT documents_intent_check CHECK (
                intent IS NULL OR intent IN (
                    'durable_knowledge',
                    'operational_log',
                    'transitional_archive'
                )
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_documents_bank ON documents(bank_id);
CREATE INDEX IF NOT EXISTS idx_documents_kind ON documents(bank_id, document_kind);
CREATE INDEX IF NOT EXISTS idx_documents_intent ON documents(bank_id, intent) WHERE intent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_session ON documents(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_event ON documents(event_started_at, event_ended_at) WHERE event_started_at IS NOT NULL;

ALTER TABLE document_chunks
    ADD COLUMN IF NOT EXISTS chunk_kind TEXT;
UPDATE document_chunks SET chunk_kind = 'content' WHERE chunk_kind IS NULL;
ALTER TABLE document_chunks
    ALTER COLUMN chunk_kind SET DEFAULT 'content';
ALTER TABLE document_chunks
    ALTER COLUMN chunk_kind SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'document_chunks_chunk_kind_check'
    ) THEN
        ALTER TABLE document_chunks
            ADD CONSTRAINT document_chunks_chunk_kind_check CHECK (
                chunk_kind IN ('content', 'heading', 'evidence', 'citation')
            );
    END IF;
END $$;

COMMIT;
