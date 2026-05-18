/**
 * OAuth2 (Bearer JWT) + legacy static-key auth for openbrain MCP.
 *
 * Mirrors the pattern in ry-el's tools/mcp-server/http_app.py (_check_auth +
 * _validate_jwt). Three modes via OPENBRAIN_AUTH_MODE:
 *   - "either" (default): accept Bearer JWT (from Authelia) OR legacy
 *     static-key (MCP_ACCESS_KEY via x-brain-key header or ?key= query).
 *     Soft cutover mode.
 *   - "oauth_only": reject legacy-key paths; require Bearer JWT.
 *   - "key_only": reject Bearer JWT; require legacy key. Mirrors pre-OAuth
 *     behavior exactly.
 *
 * JWT validation (when OAuth path is exercised):
 *   - JWKS fetched lazily on first use from <OPENBRAIN_OIDC_ISSUER>/jwks.json,
 *     cached in-process by jose's createRemoteJWKSet.
 *   - Validate RS256 signature, `iss` match, `exp`, `nbf`, `iat`.
 *   - `azp` (authorized party, fallback to `client_id` per RFC 9068 §2.2) must
 *     be in OPENBRAIN_OIDC_CLIENT_IDS (csv).
 *   - `aud` validation SKIPPED — claude.ai does not currently send the
 *     `resource` parameter (RFC 8707) in a form Authelia honors, so tokens
 *     are not audience-bound. Same documented deviation as ryel-mcp.
 *
 * On 401 the WWW-Authenticate challenge includes resource_metadata=<URL> per
 * the MCP authorization spec, so MCP clients can auto-discover the AS.
 */

import type { IncomingMessage } from "node:http";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  errors as joseErrors,
} from "jose";

// ─── Env ─────────────────────────────────────────────────────────────────────
const ACCESS_KEY = (process.env.MCP_ACCESS_KEY ?? "").trim() || null;

const RAW_AUTH_MODE = (process.env.OPENBRAIN_AUTH_MODE ?? "either").trim().toLowerCase();
const AUTH_MODE: "either" | "oauth_only" | "key_only" =
  RAW_AUTH_MODE === "oauth_only" || RAW_AUTH_MODE === "key_only" || RAW_AUTH_MODE === "either"
    ? RAW_AUTH_MODE
    : (process.stderr.write(
        `[auth] invalid OPENBRAIN_AUTH_MODE=${JSON.stringify(RAW_AUTH_MODE)}; defaulting to 'either'\n`,
      ),
      "either");

const OIDC_ISSUER = (
  process.env.OPENBRAIN_OIDC_ISSUER ?? "https://auth-orbstack-ubuntu.tail361fbc.ts.net"
).replace(/\/+$/, "");
const OIDC_JWKS_URL = `${OIDC_ISSUER}/jwks.json`;
const OIDC_ACCEPTED_CLIENT_IDS = (process.env.OPENBRAIN_OIDC_CLIENT_IDS ?? "claude-ai-openbrain")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const PUBLIC_RESOURCE_URL = (
  process.env.OPENBRAIN_PUBLIC_URL ?? "https://openbrain.tail361fbc.ts.net"
).replace(/\/+$/, "");

// ─── JWKS client (lazy + cached) ─────────────────────────────────────────────
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (_jwks === null) {
    _jwks = createRemoteJWKSet(new URL(OIDC_JWKS_URL));
  }
  return _jwks;
}

// ─── Auth result type ────────────────────────────────────────────────────────
export type AuthResult =
  | { ok: true; mode: "open" | "oauth" | "legacy_key"; logLine: string; claims?: JWTPayload }
  | { ok: false; status: number; wwwAuthenticate?: string; body: { error: string } };

// ─── WWW-Authenticate builder ────────────────────────────────────────────────
function wwwAuthenticate(error = "invalid_token", description = ""): string {
  const parts = [`Bearer realm="openbrain-mcp"`];
  if (error) parts.push(`error="${error}"`);
  if (description) {
    const safe = description.replace(/"/g, '\\"');
    parts.push(`error_description="${safe}"`);
  }
  parts.push(`resource_metadata="${PUBLIC_RESOURCE_URL}/.well-known/oauth-protected-resource"`);
  return parts.join(", ");
}

// ─── JWT validator ───────────────────────────────────────────────────────────
async function validateJwt(token: string): Promise<JWTPayload> {
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, getJwks(), {
      issuer: OIDC_ISSUER,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "iss"],
    });
    payload = result.payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new AuthError(401, "token expired", wwwAuthenticate("invalid_token", "token expired"));
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new AuthError(401, `invalid token: ${msg}`, wwwAuthenticate("invalid_token", msg));
  }

  const azp = (payload.azp as string | undefined) ?? (payload.client_id as string | undefined);
  if (!azp || !OIDC_ACCEPTED_CLIENT_IDS.includes(azp)) {
    throw new AuthError(
      401,
      `unauthorized client: ${azp ?? "(none)"}`,
      wwwAuthenticate("insufficient_scope", `client ${azp ?? "(none)"} not allowed`),
    );
  }
  return payload;
}

class AuthError extends Error {
  constructor(public status: number, public detail: string, public wwwAuthenticateHeader?: string) {
    super(detail);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────
export async function checkAuth(req: IncomingMessage, url: URL): Promise<AuthResult> {
  const authHeader = (req.headers["authorization"] as string | undefined) ?? "";
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim() || null
    : null;

  // OAuth-only path: Bearer required, JWT only, no key fallback.
  if (AUTH_MODE === "oauth_only") {
    if (!bearerToken) {
      return {
        ok: false,
        status: 401,
        wwwAuthenticate: wwwAuthenticate("invalid_token", "bearer token required"),
        body: { error: "bearer token required" },
      };
    }
    try {
      const claims = await validateJwt(bearerToken);
      return {
        ok: true,
        mode: "oauth",
        logLine: `[auth] oauth ok sub=${claims.sub} azp=${claims.azp ?? claims.client_id}`,
        claims,
      };
    } catch (e) {
      const err = e as AuthError;
      return {
        ok: false,
        status: err.status,
        wwwAuthenticate: err.wwwAuthenticateHeader,
        body: { error: err.detail },
      };
    }
  }

  // Key-only path: legacy key required, no Bearer/JWT.
  if (AUTH_MODE === "key_only") {
    if (ACCESS_KEY === null) {
      return { ok: true, mode: "open", logLine: "[auth] open (no MCP_ACCESS_KEY configured)" };
    }
    const provided =
      (req.headers["x-brain-key"] as string | undefined) ??
      bearerToken ??
      url.searchParams.get("key") ??
      null;
    if (provided !== ACCESS_KEY) {
      return { ok: false, status: 401, body: { error: "Unauthorized" } };
    }
    return { ok: true, mode: "legacy_key", logLine: "[auth] legacy_key ok" };
  }

  // Default: "either" — Bearer-first, key fallback.
  if (bearerToken) {
    try {
      const claims = await validateJwt(bearerToken);
      return {
        ok: true,
        mode: "oauth",
        logLine: `[auth] oauth ok sub=${claims.sub} azp=${claims.azp ?? claims.client_id}`,
        claims,
      };
    } catch (e) {
      // JWT failed. In "either" mode, also accept the bearer value as a legacy
      // static key — preserves existing `Authorization: Bearer <KEY>` consumers
      // during cutover.
      if (ACCESS_KEY !== null && bearerToken === ACCESS_KEY) {
        return { ok: true, mode: "legacy_key", logLine: "[auth] legacy_key (via Bearer header) ok" };
      }
      const err = e as AuthError;
      return {
        ok: false,
        status: err.status,
        wwwAuthenticate: err.wwwAuthenticateHeader,
        body: { error: err.detail },
      };
    }
  }

  // No Bearer present — fall back to legacy key carriers.
  if (ACCESS_KEY === null) {
    return { ok: true, mode: "open", logLine: "[auth] open (no MCP_ACCESS_KEY configured)" };
  }
  const headerKey = req.headers["x-brain-key"] as string | undefined;
  const queryKey = url.searchParams.get("key");
  const provided = headerKey ?? queryKey ?? null;
  if (provided !== ACCESS_KEY) {
    return {
      ok: false,
      status: 401,
      wwwAuthenticate: wwwAuthenticate("invalid_token", "bearer or legacy key required"),
      body: { error: "Unauthorized" },
    };
  }
  const carrier = headerKey ? "x-brain-key" : "query";
  return { ok: true, mode: "legacy_key", logLine: `[auth] legacy_key (via ${carrier}) ok` };
}

// ─── RFC 9728 protected-resource metadata ────────────────────────────────────
export function oauthProtectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: PUBLIC_RESOURCE_URL,
    authorization_servers: [OIDC_ISSUER],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
  };
}

export const _internal = { AUTH_MODE, OIDC_ISSUER, OIDC_ACCEPTED_CLIENT_IDS, PUBLIC_RESOURCE_URL };
