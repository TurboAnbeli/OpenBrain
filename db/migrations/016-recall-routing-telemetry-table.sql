-- 016-recall-routing-telemetry-table.sql
-- Replace 015's experiences event_type extension with a dedicated table.
-- Telemetry is operational (route decisions), not first-class memory: it does
-- not need encryption, embeddings, FTS, or to participate in recall search.

BEGIN;

-- Revert 015: remove 'recall_routing' from the experiences event_type CHECK.
-- Safe because telemetry never landed in experiences in production; smoke rows
-- were cleaned in Slice Q.3 (post-apply verification showed 0 recall_routing).
ALTER TABLE experiences
DROP CONSTRAINT IF EXISTS experiences_event_type_check,
ADD CONSTRAINT experiences_event_type_check CHECK (
    event_type IN (
        'tool_call',
        'user_message',
        'assistant_message',
        'decide',
        'external_inbox'
    )
);

CREATE TABLE IF NOT EXISTS recall_routing_telemetry (
    id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    bank_id         TEXT        NOT NULL DEFAULT 'openbrain' REFERENCES memory_banks(id) ON DELETE RESTRICT,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_router   TEXT        NOT NULL,
    route           TEXT        NOT NULL,
    source_balance  TEXT        NOT NULL,
    source_types    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    confidence      DOUBLE PRECISION,
    reasons         JSONB       NOT NULL DEFAULT '[]'::jsonb,
    project         TEXT,
    created_by      TEXT,
    CONSTRAINT recall_routing_telemetry_route_check CHECK (
        route IN ('document_only', 'thought_only', 'balanced_mixed')
    ),
    CONSTRAINT recall_routing_telemetry_source_router_check CHECK (
        source_router IN ('heuristic')
    ),
    CONSTRAINT recall_routing_telemetry_source_balance_check CHECK (
        source_balance IN ('score', 'balanced')
    )
);

CREATE INDEX IF NOT EXISTS idx_recall_routing_telemetry_bank_project_occurred
    ON recall_routing_telemetry(bank_id, project, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_recall_routing_telemetry_route_occurred
    ON recall_routing_telemetry(route, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_recall_routing_telemetry_source_types
    ON recall_routing_telemetry USING GIN(source_types);

COMMIT;
