#!/usr/bin/env python3
"""Slice W: detect entity name variants by normalized form (NFKC + lowercase
+ punctuation strip + whitespace collapse). READ-ONLY: outputs a merge
proposal JSON. Approval to apply is requested separately.

Usage:
  python3 analyze_entity_canonicalization.py [--out merge_proposal.json] [--top N]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any

import psycopg


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k] = v.strip().strip('"')
    return env


def connect():
    env = load_env(Path(os.path.expanduser("~/workspace/openbrain/.env")))
    return psycopg.connect(
        host=env.get("DB_HOST", "127.0.0.1"),
        port=int(env.get("DB_PORT", "5432")),
        user=env["DB_USER"],
        password=env["DB_PASSWORD"],
        dbname=env["DB_NAME"],
    )


PUNCT_RE = re.compile(r"[^\w\s]+", flags=re.UNICODE)
WS_RE = re.compile(r"\s+")


def normalize(name: str) -> str:
    """Per v2 plan §6: lowercase + NFKC + strip punctuation."""
    n = unicodedata.normalize("NFKC", name).casefold()
    n = PUNCT_RE.sub(" ", n)
    n = WS_RE.sub(" ", n).strip()
    return n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/openbrain_q3_fix/entity_merge_proposal.json")
    ap.add_argument("--top", type=int, default=30, help="Top-N groups to print")
    ap.add_argument(
        "--min-mentions",
        type=int,
        default=0,
        help="Only consider entities with mentions_count >= this",
    )
    args = ap.parse_args()

    conn = connect()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SELECT count(*) FROM entities")
    total = cur.fetchone()[0]
    cur.execute(
        "SELECT id, name, type, mentions_count FROM entities WHERE mentions_count >= %s ORDER BY mentions_count DESC",
        [args.min_mentions],
    )
    rows = cur.fetchall()

    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for eid, name, etype, mentions in rows:
        norm = normalize(name)
        if not norm:
            continue
        groups[(norm, etype)].append({"id": str(eid), "name": name, "mentions": int(mentions)})

    duplicate_groups = {k: v for k, v in groups.items() if len(v) > 1}

    proposed_merges: list[dict[str, Any]] = []
    for (norm, etype), members in duplicate_groups.items():
        # Canonical = highest mentions_count; tie-breaker = shortest name.
        members.sort(key=lambda m: (-m["mentions"], len(m["name"]), m["name"]))
        canonical = members[0]
        aliases = [m for m in members[1:]]
        proposed_merges.append(
            {
                "normalized": norm,
                "type": etype,
                "canonical_id": canonical["id"],
                "canonical_name": canonical["name"],
                "canonical_mentions": canonical["mentions"],
                "alias_count": len(aliases),
                "aliases": aliases,
                "total_mentions": sum(m["mentions"] for m in members),
            }
        )

    proposed_merges.sort(key=lambda g: -g["total_mentions"])

    distinct_entities_in_groups = sum(len(v) for v in duplicate_groups.values())
    distinct_entities_after_merge = len(duplicate_groups)
    entities_removed = distinct_entities_in_groups - distinct_entities_after_merge
    pct_reduction = 100 * entities_removed / total if total else 0

    summary = {
        "total_entities": total,
        "analyzed_entities": len(rows),
        "duplicate_groups": len(duplicate_groups),
        "entities_in_duplicate_groups": distinct_entities_in_groups,
        "entities_after_merge": distinct_entities_after_merge,
        "entities_removed_if_applied": entities_removed,
        "pct_reduction_if_applied": round(pct_reduction, 2),
        "v2_plan_gate_pct": 3.0,
        "passes_gate": pct_reduction >= 3.0,
        "normalization": "NFKC + casefold + strip punctuation + collapse whitespace",
    }

    out = {"summary": summary, "merges": proposed_merges}
    Path(args.out).write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"[analyze] wrote {args.out}")
    print(f"[analyze] {summary}")
    print(f"\n== Top {args.top} merge groups by total mentions ==")
    for group in proposed_merges[: args.top]:
        alias_names = ", ".join(f'"{a["name"]}"({a["mentions"]})' for a in group["aliases"])
        print(
            f'  type={group["type"]:8s} canonical="{group["canonical_name"]}" ({group["canonical_mentions"]}) <- {alias_names}'
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
