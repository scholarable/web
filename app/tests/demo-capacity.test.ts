import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
// @ts-expect-error the operator probe is a standalone Node script
import { probeDemoCapacity } from "../../scripts/probe_demo_capacity.mjs";

test("capacity probe rejects non-loopback targets before networking", async () => {
  for (const target of ["https://example.com", "http://localhost", "http://127.0.0.1/path", "http://user:password@127.0.0.1", "http://127.0.0.1/?token=x"]) {
    await assert.rejects(probeDemoCapacity(target), /loopback HTTP/);
  }
});

test("public probe is opt-in and fixed to the isolated sample origin", async () => {
  const fakeFetch = async (url: URL, init: RequestInit) => new Response(
    url.pathname === "/api/matches"
      ? JSON.stringify({ recommendations: [{ call_id: "demo-bachelor", status: "match" }] })
      : "Demo — sample data",
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
  const target = "https://scholarable-demo.curly-cake-0a19.workers.dev";
  await assert.rejects(probeDemoCapacity(target, { fetchImpl: fakeFetch }), /explicit public sample/);
  await assert.rejects(probeDemoCapacity("https://example.com", { publicSample: true, fetchImpl: fakeFetch }), /explicit public sample/);
  const result = await probeDemoCapacity(target, { publicSample: true, fetchImpl: fakeFetch });
  assert.equal(result.requests, 48);
  assert.equal(result.failures, 0);
  assert.equal(result.kind, "bounded-public-fictional-capacity-probe");
});

test("capacity probe is bounded, checks content and never follows redirects", async () => {
  let requests = 0;
  let mode = "valid";
  const server = createServer((request, response) => {
    requests++;
    if (mode === "redirect") { response.writeHead(302, { Location: "/redirect-target" }).end(); return; }
    response.setHeader("Cache-Control", "no-store");
    response.end(mode === "invalid" ? "wrong application" : request.url === "/api/matches"
      ? JSON.stringify({ recommendations: [{ call_id: "demo-bachelor", status: "match" }] })
      : ({ "/scholarships": "/scholarships/demo-bachelor", "/scholarships/demo-bachelor": "Fictional sample opportunity", "/match": 'id="scholarship-goal"' } as Record<string, string>)[request.url || ""]);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  try {
    for (mode of ["valid", "invalid", "redirect"]) {
      requests = 0;
      const result = await probeDemoCapacity(`http://127.0.0.1:${address.port}`);
      assert.equal(requests, 48);
      assert.equal(result.requests, 48);
      assert.equal(result.failures, mode === "valid" ? 0 : 48);
      assert.equal(result.concurrency, 4);
      assert.equal(Object.keys(result.routes).length, 4);
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
