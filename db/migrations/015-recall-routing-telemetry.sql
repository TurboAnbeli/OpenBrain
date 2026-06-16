-- Slice Q.3: extend experiences table to support recall_routing telemetry.
-- No new table. Adds the 'recall_routing' event type to the existing check
-- constraint so privacy-safe /recall router decisions can be retained as
-- workflow experiences.

BEGIN;

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
