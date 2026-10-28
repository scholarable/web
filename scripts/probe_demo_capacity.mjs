import { pathToFileURL } from "node:url";

const PUBLIC_SAMPLE = "https://scholarable-demo.curly-cake-0a19.workers.dev";

// Fixed fictional workload. Public mode accepts only the isolated sample origin.
export async function probeDemoCapacity(target, { publicSample = false, fetchImpl = fetch } = {}) {
  const base = new URL(target);
  const loopback = base.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(base.hostname);
  const approvedPublic = publicSample && base.origin === PUBLIC_SAMPLE;
  if ((!loopback && !approvedPublic)
    || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("Capacity probe requires loopback HTTP or the explicit public sample origin without credentials.");
  }
  const fact = value => ({ value, value_state: value === null ? "unknown" : "known", confirmation_state: "confirmed" });
  const profile = { facts: { adult_confirmation: fact(true), institution: fact("Example University"), degree_level: fact("bachelor"), subject: fact("computer_science"), semester_number: fact(null) } };
  const routes = ["/scholarships", "/scholarships/demo-bachelor", "/match", "/api/matches"];
  const localMarkers = { "/scholarships": "/scholarships/demo-bachelor", "/scholarships/demo-bachelor": "Fictional sample opportunity", "/match": 'id="scholarship-goal"' };
  const samples = [];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < 48) {
      const path = routes[next++ % routes.length];
      const start = performance.now();
      let status = 0, ok = false;
      try {
        const response = await fetchImpl(new URL(path, base), {
          redirect: "error", signal: AbortSignal.timeout(10000),
          ...(path === "/api/matches" ? { method: "POST", headers: { Origin: base.origin, "Content-Type": "application/json" }, body: JSON.stringify({ profile }) } : {}),
        });
        status = response.status;
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 262144) { await reader.cancel(); throw new Error("Response exceeds probe bound"); }
            chunks.push(chunk.value);
          }
        } finally { reader.releaseLock(); }
        const content = Buffer.concat(chunks).toString("utf8");
        ok = status === 200 && /no-store/.test(response.headers.get("cache-control") || "")
          && (path === "/api/matches"
            ? JSON.parse(content).recommendations?.some(row => row.call_id === "demo-bachelor" && row.status === "match") === true
            : content.includes(approvedPublic ? "Demo — sample data" : localMarkers[path]));
      } catch { /* Only aggregate sanitized failure counts; never output response bodies. */ }
      samples.push({ route: path, milliseconds: performance.now() - start, status, ok });
    }
  }));
  const summarize = rows => {
    const timings = rows.map(row => row.milliseconds).sort((a, b) => a - b);
    const percentile = p => Math.round(timings[Math.ceil(timings.length * p) - 1] * 100) / 100;
    return { requests: rows.length, failures: rows.filter(row => !row.ok).length,
      p50_ms: percentile(0.5), p95_ms: percentile(0.95),
      statuses: Object.fromEntries([...new Set(rows.map(row => row.status))].map(status => [status, rows.filter(row => row.status === status).length])) };
  };
  return { kind: approvedPublic ? "bounded-public-fictional-capacity-probe" : "local-fictional-capacity-probe",
    observed_at: new Date().toISOString(), concurrency: 4,
    ...summarize(samples), routes: Object.fromEntries(routes.map(route => [route, summarize(samples.filter(row => row.route === route))])),
    limitation: approvedPublic
      ? "One bounded sample-origin observation. No real-catalogue database load, global rate-limit guarantee or monthly billing cap is established."
      : "Local sample timing only. No production traffic envelope, provider rate limit, billing or database capacity is established." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const publicSample = process.argv[2] === "--public-sample";
    const result = await probeDemoCapacity(publicSample ? PUBLIC_SAMPLE : (process.argv[2] || "http://127.0.0.1:5201"), { publicSample });
    console.log(JSON.stringify(result, null, 2));
    if (result.failures) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
