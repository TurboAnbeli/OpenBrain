#!/usr/bin/env python3
"""
EmbeddingGemma FP Embedding Server (v2)

Serves the OpenAI /v1/embeddings API using official
google/embeddinggemma-300m via SentenceTransformers.

Key change from v1: When no explicit prompt suffix is provided,
uses 'query' for single-string inputs and 'document' for array inputs.
This matches the OpenBrain API usage pattern where search sends a single
string (needs query prompt) and bulk embedding sends arrays (needs document prompt).

Env:
    EMBEDDING_HOST — bind address (default: 127.0.0.1)
    EMBEDDING_PORT — port (default: 8096)
    EMBEDDING_MODEL — model ID (default: google/embeddinggemma-300m)
    EMBEDDING_DIM — output dimension (default: 768)
"""

import os
import time
import uuid
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# ── Model initialization ───────────────────────────────────────────

MODEL_ID = os.getenv("EMBEDDING_MODEL", "google/embeddinggemma-300m")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "768"))
BIND_HOST = os.getenv("EMBEDDING_HOST", "127.0.0.1")
BIND_PORT = int(os.getenv("EMBEDDING_PORT", "8096"))

print(f"[embeddinggemma-server] Loading {MODEL_ID}...", flush=True)
_t0 = time.monotonic()

import torch
from sentence_transformers import SentenceTransformer

torch.set_num_threads(4)
_model = SentenceTransformer(MODEL_ID, device="cpu")
_load_time = time.monotonic() - _t0
print(f"[embeddinggemma-server] Model loaded in {_load_time:.1f}s, dim={EMBEDDING_DIM}", flush=True)


# ── FastAPI app ────────────────────────────────────────────────────

app = FastAPI(title="EmbeddingGemma FP Server")


class EmbeddingRequest(BaseModel):
    input: str | list[str]
    model: Optional[str] = None
    encoding_format: Optional[str] = None
    dimensions: Optional[int] = None


class EmbeddingObject(BaseModel):
    object: str = "embedding"
    embedding: list[float]
    index: int


class EmbeddingResponse(BaseModel):
    object: str = "list"
    data: list[EmbeddingObject]
    model: str
    usage: dict


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL_ID, "dim": EMBEDDING_DIM}


@app.get("/v1/models")
async def models():
    return {
        "object": "list",
        "data": [
            {
                "id": MODEL_ID,
                "object": "model",
                "owned": "google",
                "meta": {"n_embd": EMBEDDING_DIM},
            }
        ],
    }


@app.post("/v1/embeddings")
async def embeddings(req: EmbeddingRequest) -> EmbeddingResponse:
    texts = req.input if isinstance(req.input, list) else [req.input]
    is_single_string = isinstance(req.input, str)

    if len(texts) == 0:
        raise HTTPException(400, "input must not be empty")

    # Determine prompt_name:
    # 1. Explicit suffix in model name (e.g. "google/embeddinggemma-300m:query")
    # 2. Default: "query" for single-string inputs (API search), "document" for array inputs (bulk)
    prompt_name = None
    model_hint = req.model or ""
    if ":query" in model_hint:
        prompt_name = "query"
    elif ":document" in model_hint:
        prompt_name = "document"
    elif is_single_string:
        prompt_name = "query"
    else:
        prompt_name = "document"

    t0 = time.monotonic()
    try:
        embeddings = _model.encode(
            texts,
            prompt_name=prompt_name,
            normalize_embeddings=True,
            batch_size=min(len(texts), 32),
            show_progress_bar=False,
        )
    except Exception as e:
        raise HTTPException(500, f"Embedding failed: {e}")

    elapsed_ms = (time.monotonic() - t0) * 1000
    total_tokens = sum(len(t.split()) for t in texts)

    data = [
        EmbeddingObject(
            object="embedding",
            embedding=emb.tolist(),
            index=i,
        )
        for i, emb in enumerate(embeddings)
    ]

    return EmbeddingResponse(
        object="list",
        data=data,
        model=MODEL_ID,
        usage={"prompt_tokens": total_tokens, "total_tokens": total_tokens},
    )


if __name__ == "__main__":
    import uvicorn
    print(f"[embeddinggemma-server] Starting on {BIND_HOST}:{BIND_PORT}", flush=True)
    uvicorn.run(app, host=BIND_HOST, port=BIND_PORT, log_level="info")