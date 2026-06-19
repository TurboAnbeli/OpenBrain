import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const exists = (path: string) => statSync(join(repoRoot, path)).isFile();

describe("OpenBrain API systemd deployment", () => {
  it("ships an API healthcheck covering service, embedder, and document read paths", () => {
    expect(exists("deploy/on-prem/systemd/openbrain-api-healthcheck.sh")).toBe(true);
    const script = read("deploy/on-prem/systemd/openbrain-api-healthcheck.sh");

    expect(script).toContain("/health");
    expect(script).toContain("/embedder/info");
    expect(script).toContain("/documents?limit=1");
    expect(script).toContain("OPENBRAIN_API_BASE_URL");
    expect(script).toContain("OPENBRAIN_HEALTHCHECK_ATTEMPTS");
    expect(script).toContain("sleep");
    expect(script).toContain("curl");
  });

  it("ships an idempotent API service installer with check and install modes", () => {
    expect(exists("deploy/on-prem/systemd/install-openbrain-api-service.sh")).toBe(true);
    const script = read("deploy/on-prem/systemd/install-openbrain-api-service.sh");

    expect(script).toContain("--check");
    expect(script).toContain("--install");
    expect(script).toContain("systemctl --user daemon-reload");
    expect(script).toContain("systemctl --user enable --now openbrain-api.service");
    expect(script).toContain("openbrain-api.service");
  });

  it("ships a canonical restart script that builds, reloads systemd, restarts, and healthchecks", () => {
    expect(exists("deploy/on-prem/systemd/restart-openbrain-api.sh")).toBe(true);
    const script = read("deploy/on-prem/systemd/restart-openbrain-api.sh");

    expect(script).toContain("pnpm build");
    expect(script).toContain("systemctl --user daemon-reload");
    expect(script).toContain("systemctl --user restart openbrain-api.service");
    expect(script).toContain("openbrain-api-healthcheck.sh");
    expect(script).not.toContain("dist/api/index.js");
  });

  it("keeps service entrypoint and package scripts aligned with the canonical API deployment", () => {
    const service = read("deploy/on-prem/systemd/openbrain-api.service");
    const start = read("deploy/on-prem/systemd/start-api.sh");
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

    expect(service).toContain("ExecStart=%h/workspace/openbrain/deploy/on-prem/systemd/start-api.sh");
    expect(start).toContain("dist/index.js");
    expect(start).not.toContain("dist/api/index.js");
    expect(pkg.scripts["api:deploy:check"]).toBe("deploy/on-prem/systemd/install-openbrain-api-service.sh --check");
    expect(pkg.scripts["api:restart"]).toBe("deploy/on-prem/systemd/restart-openbrain-api.sh");
    expect(pkg.scripts["api:healthcheck"]).toBe("deploy/on-prem/systemd/openbrain-api-healthcheck.sh");
  });
});
