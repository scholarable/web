import assert from "node:assert/strict";
import test from "node:test";
import { clearSignupFlowCookie, parseDiscoveryEvent, signupFlowCookie, validSignupFlow, writeDiscoveryEvent } from "../lib/discovery-analytics.server";
import { action as eventAction } from "../routes/api-discovery-events";

test("production discovery analytics accept only privacy-safe funnel fields", () => {
  const events = [
    { event: "enrichment_selected", enrichment: "cv" },
    { event: "enrichment_switched", enrichment: "guided" },
    { event: "clarification" }, { event: "correction" },
    { event: "first_result", elapsedMs: 24_000 },
    { event: "abandonment", elapsedMs: 31_000 },
    { event: "signup_started" }, { event: "signup_completed" },
  ];
  assert.deepEqual(events.map(parseDiscoveryEvent), events);
  for (const forbidden of ["goal", "chat", "document", "oauthToken", "profile", "value", "userId"]) {
    assert.equal(parseDiscoveryEvent({ event: "correction", [forbidden]: "private" }), null);
  }
  assert.equal(parseDiscoveryEvent({ event: "not_real" }), null);
  assert.equal(parseDiscoveryEvent({ event: "first_result", elapsedMs: -1 }), null);
  assert.equal(parseDiscoveryEvent({ event: "enrichment_selected", enrichment: "email" }), null);
});

test("production discovery analytics write aggregate dimensions without identifiers", () => {
  const points: unknown[] = [];
  const env = { SCHOLARABLE_DISCOVERY_ANALYTICS: { writeDataPoint: (point: unknown) => points.push(point) } };
  writeDiscoveryEvent(env, { event: "enrichment_switched", enrichment: "skip", elapsedMs: 8_000 });
  writeDiscoveryEvent(undefined, { event: "correction" });
  assert.deepEqual(points, [{ blobs: ["enrichment_switched", "skip"], doubles: [8_000] }]);
  assert.doesNotMatch(JSON.stringify(points), /goal|chat|document|token|profile|sensitive|value|user/i);
});

test("anonymous funnel endpoint requires same-origin, bounded production events", async () => {
  const points: unknown[] = [];
  const request = new Request("https://scholarable.test/api/discovery-events", {
    method: "POST", headers: { Origin: "https://scholarable.test", "Content-Type": "application/json" },
    body: JSON.stringify({ event: "first_result", elapsedMs: 12_000 }),
  });
  const response = await eventAction({ request, context: { cloudflare: { env: {
    SCHOLARABLE_DISCOVERY_ANALYTICS: { writeDataPoint: (point: unknown) => points.push(point) },
  } } } } as unknown as Parameters<typeof eventAction>[0]);
  assert.equal(response.status, 204);
  assert.deepEqual(points, [{ blobs: ["first_result", ""], doubles: [12_000] }]);

  const crossOrigin = new Request(request.url, { method: "POST", headers: { Origin: "https://evil.test" }, body: "{}" });
  await assert.rejects(eventAction({ request: crossOrigin } as unknown as Parameters<typeof eventAction>[0]),
    (error) => error instanceof Response && error.status === 403);
});

test("signup completion uses a short-lived signed cookie that can be cleared", async () => {
  const now = 1_800_000_000_000;
  const cookie = (await signupFlowCookie("a".repeat(32), now)).split(";")[0];
  const request = new Request("https://scholarable.test/account", { headers: { Cookie: cookie } });
  assert.equal(await validSignupFlow(request, "a".repeat(32), now + 1), true);
  assert.equal(await validSignupFlow(request, "wrong".repeat(8), now + 1), false);
  assert.equal(await validSignupFlow(request, "a".repeat(32), now + 15 * 60 * 1000 + 1), false);
  assert.match(clearSignupFlowCookie(), /Max-Age=0/);
});
