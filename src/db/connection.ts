/**
 * Database connection pool using node-postgres (pg).
 * Singleton pool with pgvector support.
 */

import fs from "node:fs";
import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let cipherKey: string | null = null;

/**
 * Read the symmetric cipher key for column-level content encryption.
 * Cached after first read. Path comes from CIPHER_KEY_PATH (typically
 * a docker-mounted file at /etc/openbrain/cipher.key, sourced from
 * the host at ~/.config/ryel/cipher.key, mode 600).
 *
 * Throws on missing or short keys — an unencrypted writable system is
 * a config error, not a state we should silently fall through.
 */
export function getCipherKey(): string {
  if (cipherKey) return cipherKey;
  const path = process.env.CIPHER_KEY_PATH;
  if (!path) {
    throw new Error(
      "CIPHER_KEY_PATH is not set. Refusing to start: column encryption requires a key. " +
        "Generate one at ~/.config/ryel/cipher.key and mount it via docker-compose.override.yml."
    );
  }
  const raw = fs.readFileSync(path, "utf8").trim();
  if (raw.length < 32) {
    throw new Error(
      `Cipher key at ${path} is too short (${raw.length} chars). ` +
        "Use at least 32 base64 characters (24 bytes of entropy)."
    );
  }
  cipherKey = raw;
  return raw;
}

export function getPool(): pg.Pool {
  if (!pool) {
    const useSSL = (process.env.DB_SSL ?? "false").toLowerCase() === "true";

    pool = new Pool({
      host: process.env.DB_HOST ?? "openbrain-postgres",
      port: parseInt(process.env.DB_PORT ?? "5432", 10),
      database: process.env.DB_NAME ?? "openbrain",
      user: process.env.DB_USER ?? "openbrain",
      password: process.env.DB_PASSWORD ?? "changeme",
      ssl: useSSL ? { rejectUnauthorized: false } : false,
      min: 2,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on("error", (err) => {
      console.error("[db] Unexpected pool error:", err.message);
    });

    console.error(
      `[db] Pool created → ${process.env.DB_HOST ?? "openbrain-postgres"}:${process.env.DB_PORT ?? "5432"}/${process.env.DB_NAME ?? "openbrain"}`
    );
  }
  return pool;
}

export async function initializeDatabase(): Promise<void> {
  // Fail fast at boot if cipher key isn't loadable, before serving traffic.
  getCipherKey();

  const db = getPool();
  const client = await db.connect();
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    const result = await client.query("SELECT COUNT(*) FROM thoughts");
    console.error(`[db] Connected. ${result.rows[0]?.count ?? 0} thoughts in database.`);
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.error("[db] Pool closed.");
  }
}
