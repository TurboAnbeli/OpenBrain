#!/usr/bin/env node
import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, join } from "node:path";

const CHECK = process.argv.includes("--check");
const ROOT = process.cwd();
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".next"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const BUDGETS = {
  prod_as_any_count: 0,
  web_dist_total_bytes: 1_030_000,
  web_dist_js_bytes: 1_000_000,
  web_dist_gzip_bytes: 330_000,
};

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

function extension(path) {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot);
}

function isTestFile(path) {
  return path.includes("/__tests__/") || /\.test\.[tj]sx?$/.test(path);
}

function sourceMetrics() {
  const files = walk(ROOT).filter((path) => SOURCE_EXTENSIONS.has(extension(path)));
  const prod = files.filter((path) => !isTestFile(path));
  const patternCounts = { prod_as_any_count: 0, prod_todo_count: 0, prod_console_log_count: 0 };
  const lineCounts = {};
  for (const file of prod) {
    const text = readFileSync(file, "utf8");
    patternCounts.prod_as_any_count += (text.match(/as any/g) ?? []).length;
    patternCounts.prod_todo_count += (text.match(/TODO/g) ?? []).length;
    patternCounts.prod_console_log_count += (text.match(/console\.log/g) ?? []).length;
  }
  for (const file of ["src/api/routes.ts", "packages/web/src/App.tsx", "src/retrieval/cross_encoder.ts"]) {
    try {
      lineCounts["lines_" + file] = readFileSync(join(ROOT, file), "utf8").split(/\r?\n/).length - 1;
    } catch {}
  }
  return { source_files: files.length, prod_source_files: prod.length, ...patternCounts, ...lineCounts };
}

function bundleMetrics() {
  const dist = join(ROOT, "packages/web/dist");
  let total = 0;
  let js = 0;
  let css = 0;
  let gzip = 0;
  let webMainStaticCodemirrorImport = false;
  const chunks = [];
  try {
    for (const file of walk(dist)) {
      const bytes = statSync(file).size;
      const content = readFileSync(file);
      const gz = gzipSync(content).length;
      total += bytes;
      gzip += gz;
      const relativePath = relative(dist, file);
      if (/^assets\/index-.*\.js$/.test(relativePath) && content.toString("utf8").includes("from\"./codemirror-")) {
        webMainStaticCodemirrorImport = true;
      }
      if (file.endsWith(".js")) js += bytes;
      if (file.endsWith(".css")) css += bytes;
      chunks.push({ path: relativePath, bytes, gzip_bytes: gz });
    }
  } catch {
    return { web_dist_present: false };
  }
  chunks.sort((a, b) => b.bytes - a.bytes);
  return {
    web_dist_present: true,
    web_dist_total_bytes: total,
    web_dist_js_bytes: js,
    web_dist_css_bytes: css,
    web_dist_gzip_bytes: gzip,
    web_main_static_codemirror_import: webMainStaticCodemirrorImport,
    largest_web_chunks: chunks.slice(0, 8),
  };
}

const metrics = {
  measured_at: new Date().toISOString(),
  ...sourceMetrics(),
  ...bundleMetrics(),
};

console.log(JSON.stringify(metrics, null, 2));

if (CHECK) {
  const failures = [];
  for (const [key, max] of Object.entries(BUDGETS)) {
    if (typeof metrics[key] === "number" && metrics[key] > max) {
      failures.push(key + "=" + metrics[key] + " exceeds budget " + max);
    }
  }
  if (metrics.web_main_static_codemirror_import) {
    failures.push("main bundle statically imports codemirror chunk");
  }
  if (failures.length > 0) {
    console.error("Optimization metric budget failures:");
    for (const failure of failures) console.error("- " + failure);
    process.exit(1);
  }
}
