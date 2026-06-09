/**
 * Cross-encoder reranker using a local ONNX model.
 *
 * Loads a cross-encoder (e.g. ms-marco-MiniLM-L-6-v2) and scores
 * query–passage pairs directly.  Much faster and more deterministic
 * than an LLM-prompt reranker.
 *
 * Uses onnxruntime-node for inference and a minimal tokenizer
 * built from HF tokenizer.json to avoid heavy image-processing
 * dependencies (sharp) that break on ARM64 Linux.
 */

import * as ort from "onnxruntime-node";
import * as fs from "fs";
import * as path from "path";

let session: ort.InferenceSession | null = null;
let vocab: Map<string, number> | null = null;
let specialTokens: { [key: string]: number } = {};
let tokenizerConfig: any = null;
let loadedModelName: string | null = null;

const CLS_TOKEN = "[CLS]";
const SEP_TOKEN = "[SEP]";
const PAD_TOKEN = "[PAD]";
const UNK_TOKEN = "[UNK]";

export interface CrossEncoderOptions {
  modelPath?: string;
  model?: string;
  maxLength?: number;
}

export function isCrossEncoderLoaded(): boolean {
  return session !== null && vocab !== null;
}

export function getLoadedModelName(): string | null {
  return loadedModelName;
}

function loadTokenizerJson(tokenizerPath: string): void {
  const raw = fs.readFileSync(tokenizerPath, "utf-8");
  const tok = JSON.parse(raw);

  vocab = new Map<string, number>();
  if (tok.model && tok.model.vocab) {
    for (const [token, id] of Object.entries(tok.model.vocab)) {
      vocab.set(token as string, id as number);
    }
  } else if (tok.vocab) {
    for (const [token, id] of Object.entries(tok.vocab)) {
      vocab.set(token as string, id as number);
    }
  }

  if (tok.added_tokens) {
    for (const t of tok.added_tokens) {
      specialTokens[t.content] = t.id;
      vocab.set(t.content, t.id);
    }
  }
}

function loadTokenizerConfig(configPath: string): void {
  const raw = fs.readFileSync(configPath, "utf-8");
  tokenizerConfig = JSON.parse(raw);
}

function wordPieceTokenize(text: string): number[] {
  if (!vocab) throw new Error("Tokenizer not loaded");

  const tokens: number[] = [];
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);

  for (const word of words) {
    let remaining = word;
    while (remaining.length > 0) {
      let longestMatch = "";
      for (let i = remaining.length; i > 0; i--) {
        const sub = remaining.slice(0, i);
        if (vocab.has(sub)) {
          longestMatch = sub;
          break;
        }
      }
      if (longestMatch === "") {
        tokens.push(vocab.get(UNK_TOKEN) ?? 100);
        break;
      }
      tokens.push(vocab.get(longestMatch)!);
      remaining = remaining.slice(longestMatch.length);
      if (remaining.length > 0) {
        remaining = "##" + remaining;
      }
    }
  }
  return tokens;
}

function encodeSequence(query: string, passage: string, maxLength: number): { inputIds: number[]; attentionMask: number[]; tokenTypeIds: number[] } {
  if (!vocab) throw new Error("Tokenizer not loaded");

  const clsId = vocab.get(CLS_TOKEN) ?? 101;
  const sepId = vocab.get(SEP_TOKEN) ?? 102;
  const padId = vocab.get(PAD_TOKEN) ?? 0;

  const queryTokens = wordPieceTokenize(query);
  const passageTokens = wordPieceTokenize(passage);

  let inputIds = [clsId, ...queryTokens, sepId, ...passageTokens, sepId];

  if (inputIds.length > maxLength) {
    inputIds = inputIds.slice(0, maxLength - 1);
    inputIds.push(sepId);
  }

  const attentionMask = inputIds.map(() => 1);
  const tokenTypeIds = [
    0, // CLS
    ...queryTokens.map(() => 0),
    0, // SEP
    ...passageTokens.map(() => 1),
    1, // final SEP
  ];

  // Truncate tokenTypeIds to match inputIds length
  const truncatedTokenTypeIds = tokenTypeIds.slice(0, inputIds.length);

  // Pad everything
  while (inputIds.length < maxLength) {
    inputIds.push(padId);
    attentionMask.push(0);
    truncatedTokenTypeIds.push(0);
  }

  return { inputIds, attentionMask, tokenTypeIds: truncatedTokenTypeIds };
}

export async function loadCrossEncoder(opts: CrossEncoderOptions): Promise<void> {
  const modelDir = opts.modelPath ?? opts.model ?? "./models";
  const tokenizerJsonPath = path.join(modelDir, "tokenizer.json");
  const tokenizerConfigPath = path.join(modelDir, "tokenizer_config.json");
  const modelPath = path.join(modelDir, "model.onnx");

  loadTokenizerJson(tokenizerJsonPath);
  if (fs.existsSync(tokenizerConfigPath)) {
    loadTokenizerConfig(tokenizerConfigPath);
  }

  session = await ort.InferenceSession.create(modelPath);
  loadedModelName = modelDir;
}

export async function scorePairs(
  query: string,
  passages: string[],
  opts?: { maxLength?: number }
): Promise<number[]> {
  if (!session) {
    throw new Error("Cross-encoder not loaded. Call loadCrossEncoder() first.");
  }

  const maxLength = opts?.maxLength ?? 512;

  const inputIdsArr: number[] = [];
  const attentionMaskArr: number[] = [];
  const tokenTypeIdsArr: number[] = [];

  for (const passage of passages) {
    const encoded = encodeSequence(query, passage, maxLength);
    inputIdsArr.push(...encoded.inputIds);
    attentionMaskArr.push(...encoded.attentionMask);
    tokenTypeIdsArr.push(...encoded.tokenTypeIds);
  }

  const batchSize = passages.length;
  const inputIdsTensor = new ort.Tensor("int64", BigInt64Array.from(inputIdsArr.map(BigInt)), [batchSize, maxLength]);
  const attentionMaskTensor = new ort.Tensor("int64", BigInt64Array.from(attentionMaskArr.map(BigInt)), [batchSize, maxLength]);
  const tokenTypeIdsTensor = new ort.Tensor("int64", BigInt64Array.from(tokenTypeIdsArr.map(BigInt)), [batchSize, maxLength]);

  const outputs = await session.run({
    input_ids: inputIdsTensor,
    attention_mask: attentionMaskTensor,
    token_type_ids: tokenTypeIdsTensor,
  });

  const outputKeys = Object.keys(outputs);
  if (outputKeys.length === 0) {
    throw new Error("ONNX model produced no outputs");
  }
  const firstOutput = (outputs as any)[outputKeys[0]!];
  const logits = firstOutput.data as Float32Array;

  const scores: number[] = [];
  for (let i = 0; i < batchSize; i++) {
    scores.push(logits[i] ?? 0);
  }

  return scores;
}

export function unloadCrossEncoder(): void {
  session = null;
  vocab = null;
  tokenizerConfig = null;
  specialTokens = {};
  loadedModelName = null;
}
