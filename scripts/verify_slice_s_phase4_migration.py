#!/usr/bin/env python3
"""Verify Slice S Phase 4 startup synthesis migration state.

Default mode expects post-migration state and exits non-zero if the migration has
not completed. Use --expect-pre to assert the known pre-migration gap.
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass

import psycopg


@dataclass
class Counts:
    active_synthesis: int
    archived_synthesis: int
    migrated_cos: int
    active_migrated_cos: int
    supersedes_links: int
    migrated_sources_with_link: int
    duplicate_source_refs: int
    active_originals_with_active_co: int


def conn_kwargs() -> dict[str, object]:
    return {
        "host": os.getenv("DB_HOST", "127.0.0.1"),
        "port": int(os.getenv("DB_PORT", "5432")),
        "dbname": os.getenv("DB_NAME"),
        "user": os.getenv("DB_USER"),
        "password": os.getenv("DB_PASSWORD"),
    }


def fetch_counts() -> Counts:
    with psycopg.connect(**conn_kwargs()) as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT
              count(*) FILTER (WHERE type='synthesis' AND archived=false) AS active_synthesis,
              count(*) FILTER (WHERE type='synthesis' AND archived=true) AS archived_synthesis
            FROM thoughts
        """)
        active_synthesis, archived_synthesis = cur.fetchone()

        cur.execute("""
            SELECT
              count(*) AS migrated_cos,
              count(*) FILTER (WHERE archived=false) AS active_migrated_cos
            FROM consolidated_observations
            WHERE history @> '[{"event":"phase4_startup_synthesis_migration"}]'::jsonb
        """)
        migrated_cos, active_migrated_cos = cur.fetchone()

        cur.execute("""
            SELECT count(*)
            FROM memory_links ml
            JOIN consolidated_observations co
              ON co.id = ml.source_id
             AND ml.source_type = 'consolidated_observation'
             AND ml.target_type = 'thought'
             AND ml.relationship = 'supersedes'
             AND ml.inferred = false
             AND ml.bank_id = 'openbrain'
            JOIN thoughts t ON t.id = ml.target_id AND t.type = 'synthesis'
            WHERE co.history @> '[{"event":"phase4_startup_synthesis_migration"}]'::jsonb
        """)
        supersedes_links = cur.fetchone()[0]

        cur.execute("""
            SELECT count(DISTINCT t.id)
            FROM thoughts t
            JOIN memory_links ml
              ON ml.target_id = t.id
             AND ml.source_type = 'consolidated_observation'
             AND ml.target_type = 'thought'
             AND ml.relationship = 'supersedes'
             AND ml.inferred = false
             AND ml.bank_id = 'openbrain'
            JOIN consolidated_observations co
              ON co.id = ml.source_id
             AND t.id = ANY(co.source_memory_ids)
            WHERE t.type = 'synthesis'
              AND co.history @> '[{"event":"phase4_startup_synthesis_migration"}]'::jsonb
        """)
        migrated_sources_with_link = cur.fetchone()[0]

        cur.execute("""
            SELECT count(*)
            FROM (
              SELECT source_id, count(*) AS refs
              FROM (
                SELECT unnest(source_memory_ids) AS source_id
                FROM consolidated_observations
                WHERE history @> '[{"event":"phase4_startup_synthesis_migration"}]'::jsonb
              ) refs
              GROUP BY source_id
              HAVING count(*) > 1
            ) duplicates
        """)
        duplicate_source_refs = cur.fetchone()[0]

        cur.execute("""
            SELECT count(*)
            FROM thoughts t
            WHERE t.type='synthesis'
              AND t.archived=false
              AND EXISTS (
                SELECT 1
                FROM consolidated_observations co
                WHERE t.id = ANY(co.source_memory_ids)
                  AND co.archived=false
                  AND co.history @> '[{"event":"phase4_startup_synthesis_migration"}]'::jsonb
              )
        """)
        active_originals_with_active_co = cur.fetchone()[0]

    return Counts(
        active_synthesis=active_synthesis,
        archived_synthesis=archived_synthesis,
        migrated_cos=migrated_cos,
        active_migrated_cos=active_migrated_cos,
        supersedes_links=supersedes_links,
        migrated_sources_with_link=migrated_sources_with_link,
        duplicate_source_refs=duplicate_source_refs,
        active_originals_with_active_co=active_originals_with_active_co,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expect-pre", action="store_true", help="Expect the known pre-migration gap instead of completed migration")
    parser.add_argument("--expected-count", type=int, default=29)
    args = parser.parse_args()

    counts = fetch_counts()
    print(counts)

    failures: list[str] = []
    if args.expect_pre:
        if counts.active_synthesis != args.expected_count:
            failures.append(f"expected {args.expected_count} active synthesis thoughts pre-migration, got {counts.active_synthesis}")
        if counts.migrated_cos != 0:
            failures.append(f"expected 0 migrated consolidated observations pre-migration, got {counts.migrated_cos}")
        if counts.supersedes_links != 0:
            failures.append(f"expected 0 migrated supersedes links pre-migration, got {counts.supersedes_links}")
    else:
        if counts.active_synthesis != 0:
            failures.append(f"expected 0 active synthesis originals after migration, got {counts.active_synthesis}")
        if counts.archived_synthesis < args.expected_count:
            failures.append(f"expected at least {args.expected_count} archived synthesis originals, got {counts.archived_synthesis}")
        if counts.migrated_cos != args.expected_count:
            failures.append(f"expected {args.expected_count} migrated consolidated observations, got {counts.migrated_cos}")
        if counts.active_migrated_cos != args.expected_count:
            failures.append(f"expected {args.expected_count} active migrated consolidated observations, got {counts.active_migrated_cos}")
        if counts.supersedes_links != args.expected_count:
            failures.append(f"expected {args.expected_count} migrated supersedes links, got {counts.supersedes_links}")
        if counts.migrated_sources_with_link != args.expected_count:
            failures.append(f"expected {args.expected_count} migrated sources with matching links, got {counts.migrated_sources_with_link}")
        if counts.duplicate_source_refs != 0:
            failures.append(f"expected no duplicate migrated source refs, got {counts.duplicate_source_refs}")
        if counts.active_originals_with_active_co != 0:
            failures.append(f"expected no active originals with active migrated CO rows, got {counts.active_originals_with_active_co}")

    if failures:
        print("FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
