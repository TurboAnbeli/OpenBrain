-- 013-consolidation-job-types.sql
-- Allow explicit Slice-B job types for the minimal consolidation worker.

BEGIN;

ALTER TABLE consolidation_jobs
    DROP CONSTRAINT IF EXISTS consolidation_jobs_job_type_check;

ALTER TABLE consolidation_jobs
    ADD CONSTRAINT consolidation_jobs_job_type_check CHECK (
        job_type IN (
            'observe',
            'observe_thoughts',
            'observe_documents',
            'supersede',
            'refresh_model',
            'reindex',
            'retain_extract'
        )
    );

COMMIT;
