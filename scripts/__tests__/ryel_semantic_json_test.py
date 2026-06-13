import importlib.util
import json
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "ryel_semantic_json.py"


def load_module():
    spec = importlib.util.spec_from_file_location("ryel_semantic_json", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_format_results_maps_ryel_rows_to_parity_json():
    module = load_module()
    rows = [
        {
            "name": "Claude Code Token Management",
            "path": "/home/ryan/workspace/ryel/wiki/claude_code_token_management.md",
            "similarity": 0.72,
            "content": "snippet text",
        }
    ]
    results = module.format_results(rows)
    assert results == [
        {
            "title": "Claude Code Token Management",
            "path": "/home/ryan/workspace/ryel/wiki/claude_code_token_management.md",
            "source_uri": "file:///home/ryan/workspace/ryel/wiki/claude_code_token_management.md",
            "score": 0.72,
            "content": "snippet text",
        }
    ]


def test_format_results_prefers_frontmatter_title_over_stem_name():
    module = load_module()
    rows = [{
        "name": "claude_code_token_management",
        "path": "wiki/claude_code_token_management.md",
        "similarity": 0.72,
        "content": "---\ntitle: \"Claude Code Token Management\"\n---\n\n# Different Heading\nBody",
    }]
    results = module.format_results(rows, ryel_root="/home/ryan/workspace/ryel")
    assert results[0]["title"] == "Claude Code Token Management"


def test_format_results_resolves_relative_ryel_paths():
    module = load_module()
    rows = [{"name": "Claude", "path": "wiki/claude.md", "similarity": 0.5}]
    results = module.format_results(rows, ryel_root="/home/ryan/workspace/ryel")
    assert results[0]["path"] == "/home/ryan/workspace/ryel/wiki/claude.md"
    assert results[0]["source_uri"] == "file:///home/ryan/workspace/ryel/wiki/claude.md"


def test_main_uses_embedding_store_and_prints_json(monkeypatch, capsys, tmp_path):
    module = load_module()
    calls = []

    class FakeStore:
        def query(self, collection, query_text, n_results=5):
            calls.append((collection, query_text, n_results))
            return [{"name": "Hybrid Memory", "path": "/vault/hybrid.md", "similarity": 0.9, "content": "x"}]

    monkeypatch.setattr(module, "build_store", lambda ryel_root: FakeStore())
    rc = module.main(["hybrid memory", "--collection", "wiki", "--limit", "3", "--ryel-root", str(tmp_path)])
    assert rc == 0
    assert calls == [("wiki", "hybrid memory", 3)]
    parsed = json.loads(capsys.readouterr().out)
    assert parsed["results"][0]["title"] == "Hybrid Memory"
