#!/usr/bin/env node
/**
 * Reindex OpenBrain document chunks against the production local GGUF embedder.
 *
 * This intentionally bypasses the HTTP API request timeout path and uses the
 * same compiled OpenBrain chunking/DB primitives directly. It is safe to rerun:
 * it only selects documents whose chunks are missing or whose chunk metadata
 * does not match the target embedder version.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const openbrainHome = process.env.OPENBRAIN_HOME
  ?? (fs.existsSync('/opt/openbrain/current/dist') ? '/opt/openbrain/current' : '/home/ryan/workspace/openbrain');
const envPath = process.env.OPENBRAIN_ENV_FILE
  ?? (fs.existsSync('/etc/openbrain/openbrain.env') ? '/etc/openbrain/openbrain.env' : path.join(openbrainHome, '.env'));

for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const idx = line.indexOf('=');
  const k = line.slice(0, idx);
  const v = line.slice(idx + 1);
  if (process.env[k] === undefined) process.env[k] = v;
}

const [{ getPool, closePool }, queries, markdown, entityExtraction] = await Promise.all([
  import(path.join(openbrainHome, 'dist/db/connection.js')),
  import(path.join(openbrainHome, 'dist/db/queries.js')),
  import(path.join(openbrainHome, 'dist/import/markdown.js')),
  import(path.join(openbrainHome, 'dist/api/entity_extraction.js')),
]);
const { listDocumentsForReindex, updateDocumentWithChunks, getDocumentChunkEmbedderVersionStats, extractAndLinkChunkEntities } = queries;
const { chunkMarkdown } = markdown;
const { extractEntities } = entityExtraction;

const endpoint = process.env.LLAMA_SERVER_ENDPOINT ?? 'http://127.0.0.1:8096';
const model = process.env.LLAMA_SERVER_EMBED_MODEL ?? 'google/embeddinggemma-300m';
const targetVersion = model;
const limit = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '25');
const batchSize = Number(process.argv.find(a => a.startsWith('--batch-size='))?.split('=')[1] ?? '8');
const once = process.argv.includes('--once');
const expectedDim = Number(process.env.OPENBRAIN_EXPECT_EMBEDDER_DIM ?? '768');

function embedBatch(texts) {
  const body = JSON.stringify({ model, input: texts });
  const r = spawnSync('curl', [
    '-fsS', '--max-time', '300', '-X', 'POST', `${endpoint}/v1/embeddings`,
    '-H', 'Content-Type: application/json', '--data-binary', '@-'
  ], {
    input: body,
    encoding: 'utf8',
    maxBuffer: 200 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`curl failed status=${r.status} stderr=${r.stderr?.slice(0, 1000)}`);
  }
  const data = JSON.parse(r.stdout);
  const embeddings = data.data?.map((x) => x.embedding);
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw new Error(`embedding count mismatch: expected ${texts.length}, got ${embeddings?.length ?? 'none'}`);
  }
  for (const e of embeddings) {
    if (!Array.isArray(e) || e.length !== expectedDim) {
      throw new Error(`bad embedding dimension ${Array.isArray(e) ? e.length : 'non-array'}`);
    }
  }
  return embeddings;
}

async function linkDocumentChunkEntities(pool, chunks) {
  for (const chunk of chunks) {
    const entities = extractEntities(chunk.content, chunk.metadata ?? undefined);
    if (entities.length > 0) await extractAndLinkChunkEntities(pool, chunk.id, entities);
  }
}

async function reindexDocument(pool, document) {
  const markdownChunks = chunkMarkdown(document.content);
  const embeddings = [];
  for (let i = 0; i < markdownChunks.length; i += batchSize) {
    const batch = markdownChunks.slice(i, i + batchSize);
    embeddings.push(...embedBatch(batch.map(c => c.content)));
  }
  const chunkInputs = markdownChunks.map((chunk, index) => ({
    chunk_index: index,
    content: chunk.content,
    embedding: embeddings[index],
    metadata: { ...(chunk.metadata ?? {}), embedder_version: targetVersion },
    token_count: chunk.token_count,
    char_start: chunk.char_start,
    char_end: chunk.char_end,
  }));
  const result = await updateDocumentWithChunks(
    pool,
    document.id,
    { edit_reason: 'bulk gguf production reindex', updated_by: 'option2-gguf-reindex' },
    chunkInputs
  );
  await linkDocumentChunkEntities(pool, result.chunks);
  return result.chunks.length;
}

const pool = getPool();
let totalDocs = 0, totalChunks = 0, failed = 0, iteration = 0;
const started = Date.now();
try {
  while (true) {
    iteration += 1;
    const candidates = await listDocumentsForReindex(pool, { targetVersion, staleOnly: true, limit });
    if (candidates.length === 0) break;
    console.log(JSON.stringify({ event: 'batch_start', iteration, candidates: candidates.length, targetVersion, stats: await getDocumentChunkEmbedderVersionStats(pool) }));
    for (const doc of candidates) {
      const t0 = Date.now();
      try {
        const chunks = await reindexDocument(pool, doc);
        totalDocs += 1; totalChunks += chunks;
        console.log(JSON.stringify({ event: 'doc_reindexed', id: doc.id, title: doc.title, chunks, ms: Date.now() - t0 }));
      } catch (err) {
        failed += 1;
        console.log(JSON.stringify({ event: 'doc_failed', id: doc.id, title: doc.title, error: String(err?.message ?? err).slice(0, 1000) }));
      }
    }
    if (once) break;
  }
  console.log(JSON.stringify({ event: 'done', totalDocs, totalChunks, failed, elapsedSec: Math.round((Date.now() - started) / 1000), stats: await getDocumentChunkEmbedderVersionStats(pool) }));
  process.exitCode = failed ? 1 : 0;
} finally {
  await closePool();
}
