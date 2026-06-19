import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const exists = (path: string) => statSync(join(repoRoot, path)).isFile();

describe("OpenBrain web Caddy deployment", () => {
  it("tracks the Caddy config that serves /web and proxies /web/api", () => {
    expect(exists("deploy/on-prem/caddy/Caddyfile.openbrain")).toBe(true);
    const caddy = read("deploy/on-prem/caddy/Caddyfile.openbrain");

    expect(caddy).toContain("orbstack-ubuntu.tail361fbc.ts.net");
    expect(caddy).toContain("openbrain.tail361fbc.ts.net");
    expect(caddy).toContain("handle_path /web/api/*");
    expect(caddy).toContain("reverse_proxy 127.0.0.1:8000");
    expect(caddy).toContain("handle_path /web/*");
    expect(caddy).toContain("root * /home/ryan/workspace/openbrain/packages/web/dist");
    expect(caddy).toContain("try_files {path} /index.html");
    expect(caddy).not.toContain("@web host web.tail361fbc.ts.net");
  });

  it("ships an installer with a dry-run mode and explicit validation", () => {
    expect(exists("deploy/on-prem/caddy/install-openbrain-caddy.sh")).toBe(true);
    const script = read("deploy/on-prem/caddy/install-openbrain-caddy.sh");

    expect(script).toContain("--check");
    expect(script).toContain("--install");
    expect(script).toContain("caddy validate");
    expect(script).toContain("Caddyfile.openbrain");
  });

  it("ships a healthcheck for HTML, assets, API health, and documents", () => {
    expect(exists("deploy/on-prem/caddy/openbrain-web-healthcheck.sh")).toBe(true);
    const script = read("deploy/on-prem/caddy/openbrain-web-healthcheck.sh");

    expect(script).toContain("/web/api/health");
    expect(script).toContain("/web/api/documents?limit=1");
    expect(script).toContain("/web/assets/");
    expect(script).toContain("OPENBRAIN_WEB_HOST_HEADER");
  });

  it("keeps Vite dev and production path prefixes aligned", () => {
    const vite = read("packages/web/vite.config.ts");
    const api = read("packages/web/src/api.ts");

    expect(vite).toContain('base: "/web/"');
    expect(vite).toContain('"/web/api"');
    expect(vite).toContain('path.replace(/^\\/web\\/api/, "")');
    expect(vite).toContain('"/api"');
    expect(api).toContain('?? "/web/api"');
  });
});
