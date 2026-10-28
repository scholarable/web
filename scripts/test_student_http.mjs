// Run against a local app without a serving credential. No live data or profile values.
import assert from "node:assert/strict";
const base = process.argv[2] || "http://127.0.0.1:5193";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname), "Local development only");
for (const path of ["/scholarships", "/scholarships.data", "/match", "/match.data", "/scholarships/test-call", "/scholarships/test-call.data", "/privacy", "/privacy.data", "/report", "/report.data"]) {
  const response = await fetch(base + path);
  assert.equal(response.headers.get("cache-control"), "no-store", path);
  assert.equal(response.status, path.includes("test-call") ? 503 : 200, path);
  if (path === "/privacy" || path === "/report") {
    assert.equal(response.headers.get("referrer-policy"), "no-referrer", path);
    const html = await response.text();
    assert.ok(html.includes(path === "/privacy" ? "Datenschutz und Kontakt" : "Es wurde noch nichts gesendet oder empfangen"), path);
  }
  if (path === "/match") {
    const html = await response.text();
    const form = html.match(/<form[^>]*>/)?.[0] || "";
    assert.match(form, /method="post"/);
    assert.match(form, /action="\/match"/);
    assert.match(html, /<button class="send" aria-label="Senden" disabled=""/);
    assert.match(html, /<noscript>/);
  }
}
console.log("Student document/data cache policy, unavailable status and pre-hydration POST safety passed.");
