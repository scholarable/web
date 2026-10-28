import assert from "node:assert/strict";
import { test } from "node:test";
import { withDemoTrafficLimit } from "../../workers/demo-traffic-limit";

test("sample traffic budget is shared across routes without visitor or profile keys", async () => {
  const keys: string[] = [];
  let calls = 0;
  for (const path of ["/", "/profile?secret=answer", "/api/match"]) {
    const response = await withDemoTrafficLimit(new Request(`https://sample.test${path}`, {
      headers: { "CF-Connecting-IP": "192.0.2.1", Cookie: "private=value" },
    }), { DEMO_TRAFFIC_LIMIT: { async limit({ key }) { keys.push(key); return { success: true }; } } },
    async () => { calls++; return new Response("allowed"); });
    assert.equal(await response.text(), "allowed");
  }
  assert.equal(calls, 3);
  assert.deepEqual(keys, Array(3).fill("scholarable-demo:dynamic:v1"));
});

test("rejected or unavailable limits stop application work and sanitize responses", async () => {
  for (const mode of ["deny", "missing", "error", "invalid"]) {
    for (const path of ["/profile", "/api/match"]) {
      const env = mode === "missing" ? {} : { DEMO_TRAFFIC_LIMIT: { async limit() {
        if (mode === "error") throw new Error("private-provider-detail");
        return { success: mode === "invalid" ? undefined as unknown as boolean : false };
      } } };
      const response = await withDemoTrafficLimit(new Request(`https://sample.test${path}`), env,
        async () => { throw new Error("application must not run"); });
      assert.equal(response.status, mode === "deny" ? 429 : 503);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(response.headers.get("Retry-After"), "60");
      const body = await response.text();
      assert.doesNotMatch(body, /private-provider-detail/);
      if (path.startsWith("/api/")) assert.equal(typeof JSON.parse(body).error, "string");
    }
  }
});
