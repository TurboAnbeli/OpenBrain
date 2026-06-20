#!/usr/bin/env bash
# Install the pinned local GGUF embedder model used by production OpenBrain.
set -euo pipefail

MODEL_DIR="${OPENBRAIN_EMBEDDER_MODEL_DIR:-/opt/openbrain/models/embeddinggemma}"
MODEL_FILE="${OPENBRAIN_EMBEDDER_MODEL_FILE:-embeddinggemma-300M-Q8_0.gguf}"
MODEL_PATH="$MODEL_DIR/$MODEL_FILE"
MODEL_URL="${OPENBRAIN_EMBEDDER_MODEL_URL:-https://huggingface.co/unsloth/embeddinggemma-300m-GGUF/resolve/main/embeddinggemma-300M-Q8_0.gguf}"
EXPECTED_SHA256="${OPENBRAIN_EMBEDDER_MODEL_SHA256:-a0f7b4e13c397a6e1b32c2de75b1f65a14c92ec524d5f674d94a4290a1c4969b}"
SERVICE_GROUP="${OPENBRAIN_SERVICE_GROUP:-openbrain}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "must run as root" >&2
  exit 77
fi

install -d -o root -g "$SERVICE_GROUP" -m 0750 "$MODEL_DIR"
if [[ ! -s "$MODEL_PATH" ]]; then
  tmp="$MODEL_PATH.tmp.$$"
  curl -fL --retry 3 --retry-delay 3 --connect-timeout 20 --max-time 600 "$MODEL_URL" -o "$tmp"
  mv "$tmp" "$MODEL_PATH"
fi

actual="$(sha256sum "$MODEL_PATH" | awk '{print $1}')"
if [[ "$actual" != "$EXPECTED_SHA256" ]]; then
  echo "model checksum mismatch for $MODEL_PATH" >&2
  echo "expected: $EXPECTED_SHA256" >&2
  echo "actual:   $actual" >&2
  exit 1
fi
chown root:"$SERVICE_GROUP" "$MODEL_PATH"
chmod 0640 "$MODEL_PATH"
echo "OpenBrain embedder model ready: $MODEL_PATH sha256=$actual"
