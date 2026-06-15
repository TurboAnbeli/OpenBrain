-- Migration 011: memory-bank core tables for one-brain runtime
--
-- Captures the live memory-bank schema already present in the running system:
-- banks, directives, links, models, experiences, and consolidation jobs.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memory_banks (
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    mission TEXT,
    disposition JSONB DEFAULT '{}'::jsonb,
    default_directive_ids UUID[] DEFAULT '{}'::uuid[],
    project TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT memory_banks_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS directives (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    bank_id TEXT NOT NULL,
    name TEXT NOT NULL,
    rule_text TEXT NOT NULL,
    applies_to JSONB DEFAULT '["reflect"]'::jsonb,
    severity TEXT DEFAULT 'hard'::text NOT NULL,
    active BOOLEAN DEFAULT true NOT NULL,
    priority INTEGER DEFAULT 0 NOT NULL,
    revision INTEGER DEFAULT 1 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT directives_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS memory_links (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    source_type TEXT NOT NULL,
    source_id UUID NOT NULL,
    target_type TEXT NOT NULL,
    target_id UUID NOT NULL,
    relationship TEXT NOT NULL,
    weight DOUBLE PRECISION DEFAULT 1.0 NOT NULL,
    inferred BOOLEAN DEFAULT true NOT NULL,
    bank_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT memory_links_pkey PRIMARY KEY (id),
    CONSTRAINT memory_links_relationship_check CHECK (
        relationship IN (
            'temporal_after',
            'temporal_before',
            'causal_cause',
            'causal_effect',
            'semantic_similar',
            'entity_co',
            'supersedes',
            'evidence_for'
        )
    ),
    CONSTRAINT memory_links_source_type_check CHECK (
        source_type IN (
            'thought',
            'document',
            'chunk',
            'consolidated_observation',
            'experience',
            'mental_model'
        )
    ),
    CONSTRAINT memory_links_target_type_check CHECK (
        target_type IN (
            'thought',
            'document',
            'chunk',
            'consolidated_observation',
            'experience',
            'mental_model'
        )
    )
);

CREATE TABLE IF NOT EXISTS mental_models (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    bank_id TEXT NOT NULL,
    name TEXT NOT NULL,
    query TEXT NOT NULL,
    content_enc BYTEA NOT NULL,
    embedding VECTOR(768),
    fts TSVECTOR,
    structured JSONB DEFAULT '{}'::jsonb,
    tags JSONB DEFAULT '[]'::jsonb,
    trigger_tags JSONB DEFAULT '[]'::jsonb,
    priority INTEGER DEFAULT 0 NOT NULL,
    refresh_meta JSONB DEFAULT '{}'::jsonb,
    history JSONB DEFAULT '[]'::jsonb,
    active BOOLEAN DEFAULT true NOT NULL,
    project TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT mental_models_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS experiences (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    bank_id TEXT NOT NULL,
    session_id TEXT,
    agent_id TEXT,
    occurred_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    event_type TEXT NOT NULL,
    content_enc BYTEA NOT NULL,
    embedding VECTOR(768),
    fts TSVECTOR,
    refs JSONB DEFAULT '{}'::jsonb,
    project TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT experiences_pkey PRIMARY KEY (id),
    CONSTRAINT experiences_event_type_check CHECK (
        event_type IN ('tool_call', 'user_message', 'assistant_message', 'decide', 'external_inbox')
    )
);

CREATE TABLE IF NOT EXISTS consolidation_jobs (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    bank_id TEXT NOT NULL,
    job_type TEXT NOT NULL,
    status TEXT DEFAULT 'queued'::text NOT NULL,
    input JSONB,
    output JSONB,
    error TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    attempts INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT consolidation_jobs_pkey PRIMARY KEY (id),
    CONSTRAINT consolidation_jobs_job_type_check CHECK (
        job_type IN ('observe', 'supersede', 'refresh_model', 'reindex', 'retain_extract')
    ),
    CONSTRAINT consolidation_jobs_status_check CHECK (
        status IN ('queued', 'running', 'success', 'error')
    )
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'directives_bank_id_name_key'
    ) THEN
        ALTER TABLE directives
            ADD CONSTRAINT directives_bank_id_name_key UNIQUE (bank_id, name);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'memory_links_source_type_source_id_target_type_target_id_re_key'
    ) THEN
        ALTER TABLE memory_links
            ADD CONSTRAINT memory_links_source_type_source_id_target_type_target_id_re_key
            UNIQUE (source_type, source_id, target_type, target_id, relationship);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'mental_models_bank_id_name_key'
    ) THEN
        ALTER TABLE mental_models
            ADD CONSTRAINT mental_models_bank_id_name_key UNIQUE (bank_id, name);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_directives_bank ON directives(bank_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_memory_links_bank ON memory_links(bank_id);
CREATE INDEX IF NOT EXISTS idx_memory_links_rel ON memory_links(relationship);
CREATE INDEX IF NOT EXISTS idx_memory_links_source ON memory_links(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_mental_models_active ON mental_models(bank_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_mental_models_bank ON mental_models(bank_id);
CREATE INDEX IF NOT EXISTS idx_mental_models_embed ON mental_models USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_mental_models_tags ON mental_models USING gin(trigger_tags);
CREATE INDEX IF NOT EXISTS idx_experiences_bank ON experiences(bank_id);
CREATE INDEX IF NOT EXISTS idx_experiences_embed ON experiences USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_experiences_event ON experiences(event_type);
CREATE INDEX IF NOT EXISTS idx_experiences_fts ON experiences USING gin(fts);
CREATE INDEX IF NOT EXISTS idx_experiences_occurred ON experiences(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_experiences_session ON experiences(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consolidation_jobs_bank ON consolidation_jobs(bank_id);
CREATE INDEX IF NOT EXISTS idx_consolidation_jobs_status ON consolidation_jobs(status, created_at);

INSERT INTO memory_banks (id, name, mission, disposition, default_directive_ids, project)
VALUES (
    'openbrain',
    'OpenBrain',
    'I am Ryan Currah''s long-term memory bank. I prioritize durable context, evidence-grounded answers, and supersession awareness. I never average conflicting facts.',
    '{"empathy": 2, "verbosity": 2, "literalism": 3, "skepticism": 4}'::jsonb,
    ARRAY[
        '741a9339-ceb3-468b-81ac-616567382122'::uuid,
        '06e1de99-502b-4865-b1e2-87c8adf01853'::uuid
    ],
    NULL
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    mission = EXCLUDED.mission,
    disposition = EXCLUDED.disposition,
    default_directive_ids = EXCLUDED.default_directive_ids,
    project = EXCLUDED.project;

INSERT INTO directives (id, bank_id, name, rule_text, applies_to, severity, active, priority, revision)
VALUES
(
    '741a9339-ceb3-468b-81ac-616567382122'::uuid,
    'openbrain',
    'no_pii_verbatim',
    'Never store MRN, PHIN, DOB, SIN, patient names, or identifying medical details verbatim. Route hits to intent=transitional_archive and flag for manual review.',
    '["reflect", "recall", "retain"]'::jsonb,
    'hard',
    true,
    100,
    1
),
(
    '06e1de99-502b-4865-b1e2-87c8adf01853'::uuid,
    'openbrain',
    'no_fact_averaging',
    'Do not average conflicting facts during consolidation. Preserve both rows with timestamps and a supersedes link. Never narrative-smooth contradictions into softened claims.',
    '["reflect", "retain"]'::jsonb,
    'hard',
    true,
    90,
    1
)
ON CONFLICT (id) DO UPDATE SET
    bank_id = EXCLUDED.bank_id,
    name = EXCLUDED.name,
    rule_text = EXCLUDED.rule_text,
    applies_to = EXCLUDED.applies_to,
    severity = EXCLUDED.severity,
    active = EXCLUDED.active,
    priority = EXCLUDED.priority,
    revision = EXCLUDED.revision;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'documents_bank_id_fkey'
    ) THEN
        ALTER TABLE documents
            ADD CONSTRAINT documents_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES memory_banks(id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'directives_bank_id_fkey'
    ) THEN
        ALTER TABLE directives
            ADD CONSTRAINT directives_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES memory_banks(id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'memory_links_bank_id_fkey'
    ) THEN
        ALTER TABLE memory_links
            ADD CONSTRAINT memory_links_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES memory_banks(id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'mental_models_bank_id_fkey'
    ) THEN
        ALTER TABLE mental_models
            ADD CONSTRAINT mental_models_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES memory_banks(id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'experiences_bank_id_fkey'
    ) THEN
        ALTER TABLE experiences
            ADD CONSTRAINT experiences_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES memory_banks(id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'consolidation_jobs_bank_id_fkey'
    ) THEN
        ALTER TABLE consolidation_jobs
            ADD CONSTRAINT consolidation_jobs_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES memory_banks(id);
    END IF;
END $$;

COMMIT;
