import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

// Deliberately strict JSON: comments/extra configuration require review of this
// small allowlist before deployment. Never print configuration values on error.
export async function demoPreflight(root = process.cwd()) {
  const config = JSON.parse(await readFile(join(root, "wrangler.demo.jsonc"), "utf8"));
  const expected = {
    $schema: "node_modules/wrangler/config-schema.json",
    name: "scholarable-demo",
    main: "./workers/demo.ts",
    assets: { directory: "./build/client", binding: "ASSETS" },
    compatibility_date: "2026-09-12",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: true,
    preview_urls: false,
    observability: { enabled: false },
    ratelimits: [{ name: "DEMO_TRAFFIC_LIMIT", namespace_id: "2026091501", simple: { limit: 600, period: 60 } }],
    limits: { cpu_ms: 1000 },
  };
  // Avoid assert.deepEqual here: its error would dump values from unsafe config.
  assert.ok(isDeepStrictEqual(config, expected), "Demo configuration changed; review target and bindings before deploying");
  let server = "";
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (entry.name.endsWith(".js")) server += await readFile(file, "utf8");
    }
  }
  await scan(join(root, "build/server"));
  for (const marker of ["demo-bachelor", "demo-master", "demo-doctoral", "demo-exchange", "Example University", "Demo — sample data"]) {
    assert.ok(server.includes(marker), "Sample build missing; run npm run build:demo before deploying");
  }
  return "Demo preflight passed: sample server build, separate demo target, assets and traffic-limit configuration, logs disabled. Remote bindings/secrets still require operator verification.";
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(await demoPreflight()); }
  catch { console.error("Demo preflight failed. Verify the dedicated sample-only demo configuration and rebuild with npm run build:demo. Configuration values were not logged."); process.exitCode = 1; }
}
