-- Migration 009: source documents, chunks, and revisions for one-brain architecture
--
-- Adds database-first source-document storage under OpenBrain. Documents keep
-- encrypted source text, editable metadata/provenance, optional chunks, and
-- revision history for source edits. This is foundational DDL only; retrieval
-- behavior remains unchanged until API/search integration lands.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
    id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    title       TEXT        NOT NULL,
    source_type TEXT        NOT NULL,
    source_uri  TEXT,
    content_enc BYTEA       NOT NULL,
    metadata    JSONB       DEFAULT '{}'::jsonb,
    project     TEXT,
    created_by  TEXT,
    status      TEXT        DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
    fts         TSVECTOR,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

DROP TRIGGER IF EXISTS set_documents_updated_at ON documents;
CREATE TRIGGER set_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_documents_source_type ON documents(source_type);
CREATE INDEX IF NOT EXISTS idx_documents_source_uri ON documents(source_uri);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project);
CREATE INDEX IF NOT EXISTS idx_documents_created_by ON documents(created_by);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_metadata ON documents USING gin(metadata);
CREATE INDEX IF NOT EXISTS idx_documents_fts ON documents USING gin(fts);

CREATE TABLE IF NOT EXISTS document_chunks (
    id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    document_id  UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index  INT         NOT NULL,
    content_enc  BYTEA       NOT NULL,
    embedding    VECTOR(768),
    metadata     JSONB       DEFAULT '{}'::jsonb,
    token_count  INT,
    char_start   INT,
    char_end     INT,
    fts          TSVECTOR,
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE(document_id, chunk_index)
);

DROP TRIGGER IF EXISTS set_document_chunks_updated_at ON document_chunks;
CREATE TRIGGER set_document_chunks_updated_at
    BEFORE UPDATE ON document_chunks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
    ON document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_document_chunks_metadata ON document_chunks USING gin(metadata);
CREATE INDEX IF NOT EXISTS idx_document_chunks_fts ON document_chunks USING gin(fts);

CREATE TABLE IF NOT EXISTS document_revisions (
    id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    document_id     UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    revision_number INT         NOT NULL,
    title           TEXT        NOT NULL,
    source_uri      TEXT,
    content_enc     BYTEA       NOT NULL,
    metadata        JSONB       DEFAULT '{}'::jsonb,
    status          TEXT        NOT NULL,
    edit_reason     TEXT,
    created_by      TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(document_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_document_revisions_document_id ON document_revisions(document_id);

COMMIT;
