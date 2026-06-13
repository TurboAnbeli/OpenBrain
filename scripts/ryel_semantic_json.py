#!/usr/bin/env python3
"""Ry-El semantic search adapter for OpenBrain import parity reports.

Prints JSON in the shape consumed by `pnpm run import:parity -- --ryel-command ...`.
The adapter imports Ry-El's pgvector-backed EmbeddingStore directly and queries the
selected collection (default: wiki).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any
import re


def normalize_path(raw_path: str, ryel_root: str | None = None) -> str:
    if not raw_path:
        return ""
    path = Path(raw_path)
    if path.is_absolute():
        return str(path)
    root = Path(ryel_root or "/home/ryan/workspace/ryel").expanduser().resolve()
    return str((root / path).resolve())



def display_title(row: dict[str, Any]) -> str | None:
    content = str(row.get("content") or "")
    match = re.search(r'^title:\s*["\']?([^"\'\n]+)["\']?\s*$', content, re.MULTILINE)
    if match:
        return match.group(1).strip()
    match = re.search(r'^#\s+(.+)$', content, re.MULTILINE)
    if match:
        return match.group(1).strip()
    name = row.get("name")
    return str(name) if name is not None else None


def format_results(rows: list[dict[str, Any]], ryel_root: str | None = None) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for row in rows:
        path = normalize_path(str(row.get("path") or ""), ryel_root)
        item: dict[str, Any] = {
            "title": display_title(row),
            "path": path,
            "source_uri": f"file://{path}" if path else None,
            "score": float(row.get("similarity") or 0.0),
        }
        if row.get("content") is not None:
            item["content"] = row.get("content")
        results.append(item)
    return results


def build_store(ryel_root: str):
    root = Path(ryel_root).expanduser().resolve()
    mcp_dir = root / "tools" / "mcp-server"
    if not mcp_dir.exists():
        raise RuntimeError(f"Ry-El MCP directory not found: {mcp_dir}")
    sys.path.insert(0, str(mcp_dir))
    from embeddings import EmbeddingStore  # type: ignore

    return EmbeddingStore()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Emit Ry-El semantic search results as parity JSON")
    parser.add_argument("query", help="Search query")
    parser.add_argument("--collection", default="wiki", help="Ry-El embedding collection, default: wiki")
    parser.add_argument("--limit", type=int, default=5, help="Number of results, default: 5")
    parser.add_argument("--ryel-root", default="/home/ryan/workspace/ryel", help="Ry-El repo root")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(list(argv or sys.argv[1:]))
    store = build_store(args.ryel_root)
    rows = store.query(args.collection, args.query, n_results=args.limit)
    print(json.dumps({"results": format_results(rows, args.ryel_root)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
