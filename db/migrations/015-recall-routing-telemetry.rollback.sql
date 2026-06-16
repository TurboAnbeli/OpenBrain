-- Rollback for 015-recall-routing-telemetry.sql
-- Removes recall_routing from the event_type check constraint. Any existing
-- recall_routing rows would need to be archived/deleted before this rollback
-- can succeed if they exist.

BEGIN;

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

COMMIT;
