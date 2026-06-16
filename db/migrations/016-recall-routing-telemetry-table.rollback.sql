-- 016-recall-routing-telemetry-table.rollback.sql
-- Drop the dedicated telemetry table and re-allow 'recall_routing' in the
-- experiences event_type CHECK (restores 015's state). Any rows in
-- recall_routing_telemetry are lost by this rollback.

BEGIN;

DROP TABLE IF EXISTS recall_routing_telemetry;

ALTER TABLE experiences
DROP CONSTRAINT IF EXISTS experiences_event_type_check,
ADD CONSTRAINT experiences_event_type_check CHECK (
    event_type IN (
        'tool_call',
        'user_message',
        'assistant_message',
        'decide',
        'external_inbox',
        'recall_routing'
    )
);

COMMIT;
