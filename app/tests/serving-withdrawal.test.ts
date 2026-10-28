import assert from "node:assert/strict";
import test from "node:test";
import { browseServingCalls, servingCall, servingQuery } from "../lib/serving.server";

// Synthetic serving-view boundary, not a human publication receipt.
test("browse and detail reread serving state after withdrawal and distinguish outages", async () => {
  let visible = true;
  let reads = 0;
  const row = { id: "synthetic", slug: "synthetic-call", title: "Synthetic call", application_status: "open", details: null };
  const connect = async () => (async (sql: string) => { reads++; return visible ? (sql.includes("as subject") ? [{ subject: "engineering" }] : [row]) : []; }) as unknown as Awaited<ReturnType<typeof servingQuery>>;
  const env = { SCHOLARABLE_SERVING_DATABASE_URL: "synthetic-test-boundary" };
  const url = new URL("https://example.test/scholarships");
  const before = await browseServingCalls(url, env, connect);
  assert.equal(before.state, "ready");
  assert.deepEqual(before.subjects, [{ value: "engineering", label: null }]);
  if (before.state === "ready") assert.equal(before.scholarships.length, 1);
  assert.equal((await servingCall(row.slug, env, connect)).state, "ready");
  visible = false;
  const after = await browseServingCalls(url, env, connect);
  if (after.state === "ready") { assert.deepEqual(after.scholarships, []); assert.deepEqual(after.subjects, []); }
  else assert.fail("Withdrawal is an empty catalogue, not an outage");
  assert.equal((await servingCall(row.slug, env, connect)).state, "missing");
  assert.equal(reads, 6);
  const broken = async () => { throw new Error("private connection details"); };
  assert.equal((await servingCall(row.slug, env, broken)).state, "unavailable");
  assert.equal((await browseServingCalls(url, env, broken)).state, "unavailable");
  assert.equal((await servingCall(row.slug, undefined)).state, "unavailable");
});

// Owner decisions (2026-10-13): closed now with a known next round reads
// "opens later"; a deadline set per country or group says so.
test("catalogue timing says when a call opens later or its deadline depends on the applicant", async () => {
  const rows = [
    { id: "1", slug: "open", title: "Open", application_status: "open", effective_application_state: "open", deadline_on: "2026-10-31" },
    { id: "2", slug: "later", title: "Later", application_status: "planned", effective_application_state: "announced", deadline_on: "2027-04-01" },
    { id: "3", slug: "country", title: "Country", application_status: "not_announced", effective_application_state: "provider_defined", deadline_on: null },
  ];
  const connect = async () => (async (sql: string) => sql.includes("as subject") ? [] : rows) as unknown as Awaited<ReturnType<typeof servingQuery>>;
  const result = await browseServingCalls(new URL("https://example.test/scholarships"), { SCHOLARABLE_SERVING_DATABASE_URL: "synthetic-test-boundary" }, connect);
  if (result.state !== "ready") assert.fail("synthetic catalogue unavailable");
  assert.deepEqual(result.scholarships.map(item => [item.status, item.deadline]), [
    ["open", "Deadline 31 October 2026"],
    ["planned", "Opens later · next deadline 1 April 2027"],
    ["not_announced", "Deadline depends on your country or group"],
  ]);
});

// Live bug (2026-10-19): the Neon driver returns a `date` column as a
// JavaScript Date, so list cards and the detail fact strip said "Timing on the
// provider page" for calls with a published deadline. This fake answers like
// the driver: a Date unless the query sends the day as text.
test("list and detail read the deadline the database sends, not a driver Date", async () => {
  const row = { id: "8", slug: "hamburg", title: "Hamburg", application_status: "open", effective_application_state: "open", details: null };
  const connect = async () => (async (sql: string) => sql.includes("as subject") ? []
    : [{ ...row, deadline_on: sql.includes("to_char(r.deadline_on, 'YYYY-MM-DD') as deadline_on") ? "2026-10-25" : new Date(2026, 9, 25) }]) as unknown as Awaited<ReturnType<typeof servingQuery>>;
  const env = { SCHOLARABLE_SERVING_DATABASE_URL: "synthetic-test-boundary" };
  const list = await browseServingCalls(new URL("https://example.test/scholarships"), env, connect);
  if (list.state !== "ready") assert.fail("synthetic catalogue unavailable");
  assert.equal(list.scholarships[0].deadline, "Deadline 25 October 2026");
  const detail = await servingCall("hamburg", env, connect);
  if (detail.state !== "ready") assert.fail("synthetic call unavailable");
  assert.equal(detail.scholarship.deadline, "Deadline 25 October 2026");
});
