import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { MATCH, MISMATCH, UNKNOWN, callFromPayload, evaluateCall, normaliseServingCall, recommend, type MatchCall, type Profile } from "../lib/matching";

// Parity fixture mirrors scripts/test_scholarship_matching.py; no production data.
const fact = (value: unknown, value_state = "known", confirmation_state = "confirmed") => ({ value, value_state, confirmation_state });
const profile: Profile = { facts: { degree_level: fact("bachelor"), subject: fact("computer_science"), semester_number: fact(2), citizenship: fact("XK"), destination_country: fact("FR"), future_plan: fact("exchange") } };
const call: MatchCall = {
  id: "example", recommendation_ready: true, serving_state: "ready",
  tracks: [{ id: "computing" }, { id: "medicine" }],
  groups: [{ id: "core", logic: "all" }, { id: "choice", parent_id: "core", logic: "any" }, { id: "computing", track_id: "computing", logic: "all" }, { id: "medicine", track_id: "medicine", logic: "all" }, { id: "outbound", logic: "none" }],
  requirements: [
    { id: "degree", group_id: "core", fact_key: "degree_level", kind: "required", operator: "in", expected: ["bachelor", "master"], label: "Degree" },
    { id: "exchange", group_id: "choice", fact_key: "future_plan", kind: "required", operator: "eq", expected: "exchange", label: "Exchange" },
    { id: "internship", group_id: "choice", fact_key: "future_plan", kind: "required", operator: "eq", expected: "internship", label: "Internship" },
    { id: "computing", group_id: "computing", track_id: "computing", fact_key: "subject", kind: "required", operator: "eq", expected: "computer_science", label: "Computing" },
    { id: "medicine", group_id: "medicine", track_id: "medicine", fact_key: "subject", kind: "required", operator: "eq", expected: "medicine", label: "Medicine" },
    { id: "not-doctoral", group_id: "outbound", fact_key: "degree_level", kind: "required", operator: "eq", expected: "doctoral", label: "Not doctoral" },
    { id: "preferred", group_id: "core", fact_key: "subject", kind: "preferred", operator: "eq", expected: "computer_science", label: "Preferred" },
  ],
  routes: [{ id: "computer-route", track_id: "computing", condition_group_id: "outbound", availability_status: "available" }, { id: "medicine-route", track_id: "medicine", availability_status: "available" }],
  windows: [{ id: "computer-open", track_id: "computing", route_id: "computer-route", state: "open" }, { id: "medicine-future", track_id: "medicine", route_id: "medicine-route", state: "announced" }],
};

const pythonRecommend = (calls: unknown[], input: Profile, payloads = false) => {
  const script = `import json, sys
sys.path.insert(0, "scripts")
from scholarship_matching import recommend
data = json.load(sys.stdin)
if data["payloads"]:
 from scholarship_matching_postgres import _call_from_payload
 data["calls"] = [_call_from_payload(item) for item in data["calls"]]
json.dump(recommend(data["calls"], data["profile"]), sys.stdout, sort_keys=True)`;
  const result = spawnSync("python3", ["-c", script], { cwd: process.cwd(), input: JSON.stringify({ calls, profile: input, payloads }), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

test("manual review and malformed operands remain unknown with Python parity", () => {
  const cases: [string, unknown, unknown][] = [
    ["eq", {}, "bachelor"], ["neq", {}, "bachelor"],
    ["not_in", [{}], "bachelor"], ["in", [], "bachelor"],
    ["eq", 1, true], ["neq", "1", 1],
    ["gte", true, 1], ["lte", "z", "a"],
    ["between", [3, 1], 2], ["between", [1, "3"], 2],
  ];
  for (const [operator, expected, value] of cases) {
    const input = { facts: { answer: fact(value) } };
    const invalid: MatchCall = { id: "invalid", recommendation_ready: true, serving_state: "ready",
      requirements: [{ id: "rule", fact_key: "answer", label: "Rule", kind: "required", operator, expected }],
      routes: [{ id: "route", availability_status: "available" }], windows: [{ state: "open" }] };
    const result = recommend([invalid], input);
    assert.equal(result[0].status, UNKNOWN);
    assert.equal(result[0].actionable, false);
    assert.deepEqual(result, pythonRecommend([invalid], input));
  }
  const manual: MatchCall = { id: "manual", recommendation_ready: true, serving_state: "ready",
    requirements: [{ id: "rule", fact_key: "answer", label: "Requires review", kind: "manual_review", operator: "any" }],
    routes: [{ id: "route", availability_status: "available" }], windows: [{ state: "open" }] };
  assert.equal(recommend([manual], profile)[0].status, UNKNOWN);
  assert.equal(recommend([manual], profile)[0].actionable, false);
  assert.deepEqual(recommend([manual], profile), pythonRecommend([manual], profile));
});

test("known out-of-scope groups and descendants are excluded, missing groups remain unknown", () => {
  const scoped: MatchCall = { id: "scoped", recommendation_ready: true, serving_state: "ready",
    tracks: [{ id: "current" }],
    groups: [{ id: "renewal", applies_to: "renewal", logic: "all" },
      { id: "child", parent_id: "renewal", logic: "all" },
      { id: "other-track", track_id: "other", logic: "all" },
      { id: "track-child", parent_id: "other-track", logic: "all" }],
    requirements: ["renewal", "child", "other-track", "track-child"].map((group_id) => ({
      id: group_id, group_id, fact_key: "missing", label: "Out of scope", kind: "required", operator: "eq", expected: "x",
    })), routes: [{ id: "route", availability_status: "available" }], windows: [{ state: "open" }] };
  scoped.requirements!.push({ id: "base", fact_key: "other", label: "All applicants", kind: "required", operator: "any" });
  let result = recommend([scoped], profile);
  assert.equal(result[0].status, MATCH);
  assert.equal(result[0].actionable, true);
  assert.deepEqual(result[0].criteria.matched.map((item) => item.id), ["base"]);
  assert.deepEqual(result, pythonRecommend([scoped], profile));
  scoped.requirements!.push({ id: "missing", group_id: "does-not-exist", fact_key: "other", label: "Missing group", kind: "required", operator: "any" });
  result = recommend([scoped], profile);
  assert.equal(result[0].status, UNKNOWN);
  assert.deepEqual(result, pythonRecommend([scoped], profile));
});

test("matches nested all/any/none groups without track leakage", () => {
  const [computing, medicine] = evaluateCall(call, profile);
  assert.equal(computing.status, MATCH);
  assert.equal(computing.actionable, true);
  assert.equal(computing.preference_matches, 1);
  assert.equal(medicine.status, MISMATCH);
  assert.equal(computing.criteria.mismatched.some((item) => item.id === "medicine"), false);
  assert.equal(medicine.criteria.matched.some((item) => item.id === "not-doctoral"), false);
  const blockedByNone = structuredClone(call);
  blockedByNone.requirements!.find(item => item.id === "not-doctoral")!.expected = "bachelor";
  const groupedMismatch = evaluateCall(blockedByNone, profile)[0];
  assert.equal(groupedMismatch.status, MISMATCH);
  assert.ok(groupedMismatch.criteria.mismatched.some(item => item.reason === "group_not_satisfied"));
});

test("fails closed for missing, withheld, malformed, manual and future/closed facts", () => {
  const withheld = structuredClone(profile);
  withheld.facts!.citizenship = fact(null, "prefer_not_to_say");
  const guarded = structuredClone(call);
  guarded.requirements!.push({ id: "citizen", group_id: "core", fact_key: "citizenship", kind: "required", operator: "eq", expected: "XK", label: "Citizenship" });
  guarded.requirements!.push({ id: "manual", group_id: "core", fact_key: "subject", kind: "manual_review", operator: "manual", label: "Manual" });
  const result = evaluateCall(guarded, withheld)[0];
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.actionable, false);
  assert.equal(result.criteria.unknown.some((item) => item.reason === "prefer_not_to_say"), true);
  const closed = structuredClone(call); closed.windows![0].state = "closed";
  assert.equal(evaluateCall(closed, profile)[0].actionable, false);
  assert.equal(evaluateCall(call, profile)[1].window_state, "announced");
  const scoped = structuredClone(call);
  scoped.windows!.push({ id: "z-global-closed", state: "closed" });
  assert.equal(evaluateCall(scoped, profile)[0].window_state, "open");
});

test("ranks hard mismatches last with their diagnostics", () => {
  const mismatch = structuredClone(profile); mismatch.facts!.degree_level = fact("doctoral");
  const mismatched = recommend([call], mismatch);
  assert.ok(mismatched.length > 0);
  assert.ok(mismatched.every(item => item.status === MISMATCH));
  assert.ok(mismatched.some(item => item.criteria.mismatched.some(criterion => criterion.id === "degree")));
  const possible = structuredClone(call); possible.id = "possible";
  const unknown = structuredClone(profile); unknown.facts!.degree_level = fact("bachelor", "known", "unconfirmed");
  const unknownResults = recommend([possible, call], unknown);
  assert.deepEqual(unknownResults.map((item) => item.call_id), ["example", "possible"]);
  assert.ok(unknownResults.every(item => item.status === UNKNOWN));
  const closed = structuredClone(call); closed.id = "closed"; closed.windows![0].state = "closed";
  const closedResults = recommend([closed, call], profile);
  assert.deepEqual(closedResults.map((item) => item.call_id), ["example", "closed"]);
  assert.ok(closedResults.every(item => item.status === MATCH));
});

test("normalises only atomic expected envelopes", () => {
  const served = normaliseServingCall({ id: "served", recommendation_ready: true, serving_state: "ready", groups: [{ id: "core", logic: "all" }], requirements: [
    { id: "atomic", group_id: "core", criterion_key: "degree_level", kind: "required", operator: "eq", value: { expected: "bachelor" }, label: "Degree" },
    { id: "legacy", group_id: "core", criterion_key: "subject", kind: "preferred", operator: "eq", value: { provider_value: "computer_science" }, label: "Legacy" },
  ], routes: [{ id: "route", availability_status: "available" }], windows: [{ id: "window", route_id: "route", state: "open" }] });
  const result = evaluateCall(served, profile)[0];
  assert.equal(result.status, MATCH);
  assert.equal(result.criteria.unknown.some((item) => item.id === "legacy" && item.reason === "unsupported_rule"), true);
});

test("fails closed for unreachable groups and rejects inputs beyond matcher limits", () => {
  const malformed: MatchCall = {
    id: "malformed", recommendation_ready: true, serving_state: "ready",
    groups: [{ id: "root", logic: "all" }, { id: "orphan", parent_id: "missing", logic: "all" }],
    requirements: [
      { id: "degree", group_id: "root", fact_key: "degree_level", kind: "required", operator: "eq", expected: "bachelor", label: "Degree" },
      { id: "orphan", group_id: "orphan", fact_key: "subject", kind: "required", operator: "eq", expected: "computer_science", label: "Orphan" },
    ], routes: [{ id: "route", availability_status: "available" }], windows: [{ route_id: "route", state: "open" }],
  };
  const result = evaluateCall(malformed, profile)[0];
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.actionable, false);
  assert.equal(result.criteria.unknown.some((item) => item.id === "group:orphan"), true);
  const cyclic = structuredClone(malformed);
  cyclic.groups = [{ id: "a", parent_id: "b", logic: "all" }, { id: "b", parent_id: "a", logic: "all" }];
  cyclic.requirements![0].group_id = "a";
  cyclic.requirements![1].group_id = "b";
  assert.equal(evaluateCall(cyclic, profile)[0].status, UNKNOWN);
  const oversized = structuredClone(malformed);
  oversized.requirements = Array.from({ length: 501 }, (_, index) => ({ id: `rule-${index}`, fact_key: "degree_level", kind: "required", operator: "eq", expected: "bachelor", label: "Rule" }));
  assert.throws(() => evaluateCall(oversized, profile), /unsupported matching input/);
  const tooManyRoutes = structuredClone(malformed);
  tooManyRoutes.routes = Array.from({ length: 21 }, (_, index) => ({ id: `route-${index}`, availability_status: "available" }));
  assert.throws(() => evaluateCall(tooManyRoutes, profile), /unsupported matching input/);
  const tooManyWindows = structuredClone(malformed);
  tooManyWindows.windows = Array.from({ length: 501 }, (_, index) => ({ id: `window-${index}`, state: "open" }));
  assert.throws(() => evaluateCall(tooManyWindows, profile), /unsupported matching input/);
  assert.throws(() => recommend(Array.from({ length: 1001 }, () => malformed), profile), /unsupported matching input/);
});

test("matches the Python reference on valid nested, ranked, operator and serving-envelope cases", () => {
  const operators: MatchCall = {
    id: "operators", recommendation_ready: true, serving_state: "ready", groups: [{ id: "core", logic: "all" }],
    requirements: [
      { id: "eq", group_id: "core", fact_key: "degree_level", kind: "required", operator: "eq", expected: "bachelor", label: "Equal" },
      { id: "neq", group_id: "core", fact_key: "subject", kind: "required", operator: "neq", expected: "medicine", label: "Not medicine" },
      { id: "in", group_id: "core", fact_key: "citizenship", kind: "required", operator: "in", expected: ["XK", "DE"], label: "Included" },
      { id: "not-in", group_id: "core", fact_key: "citizenship", kind: "required", operator: "not_in", expected: ["US"], label: "Not excluded" },
      { id: "gte", group_id: "core", fact_key: "semester_number", kind: "required", operator: "gte", expected: 2, label: "Minimum semester" },
      { id: "lte", group_id: "core", fact_key: "semester_number", kind: "required", operator: "lte", expected: 2, label: "Maximum semester" },
      { id: "between", group_id: "core", fact_key: "semester_number", kind: "required", operator: "between", expected: [1, 3], label: "Semester range" },
      { id: "exists", group_id: "core", fact_key: "subject", kind: "required", operator: "exists", expected: true, label: "Subject supplied" },
      { id: "excluded", group_id: "core", fact_key: "citizenship", kind: "exclusion", operator: "eq", expected: "US", label: "US exclusion" },
      { id: "any", group_id: "core", fact_key: "other", kind: "required", operator: "any", label: "Any applicant" },
      { id: "preferred", group_id: "core", fact_key: "subject", kind: "preferred", operator: "eq", expected: "computer_science", label: "Preferred subject" },
    ], routes: [{ id: "direct", availability_status: "available" }], windows: [{ id: "open", route_id: "direct", state: "open" }],
  };
  const missing = structuredClone(operators);
  missing.id = "missing";
  missing.requirements![0].fact_key = "missing_fact";
  const corpus = [call, operators, missing];
  assert.deepEqual(recommend(corpus, profile), pythonRecommend(corpus, profile));

  const payload = { id: "served", recommendation_ready: true, serving_state: "ready", groups: [{ id: "core", logic: "all" }], requirements: [
    { id: "atomic", group_id: "core", criterion_key: "degree_level", kind: "required", operator: "eq", value: { expected: "bachelor" }, label: "Degree" },
    { id: "any", group_id: "core", criterion_key: "other", kind: "required", operator: "any", label: "Any applicant" },
  ], routes: [{ id: "direct", availability_status: "available" }], windows: [{ id: "open", route_id: "direct", state: "open" }] };
  assert.deepEqual(recommend([callFromPayload(payload)], profile), pythonRecommend([payload], profile, true));
});


test("equally scoped windows never choose an actionable deadline by ID or input order", () => {
  for (const states of [["closed", "open"], ["open", "closed"], ["open", "open"]]) {
    const ambiguous = structuredClone(call);
    ambiguous.windows!.push({ ...ambiguous.windows![0], id: "second-window", state: states[1] });
    ambiguous.windows![0].state = states[0];
    for (const windows of [ambiguous.windows!, [...ambiguous.windows!].reverse()]) {
      const input = { ...ambiguous, windows };
      const result = recommend([input], profile);
      assert.equal(result[0].window_state, "unknown");
      assert.equal(result[0].actionable, false);
      assert.deepEqual(result, pythonRecommend([input], profile));
    }
  }
});

test("representative synthetic facts cover ranges, residence, experience and future plans without inferring missing answers", () => {
  const facts = { degree_level: "bachelor", subject: "computer_science", semester_number: 2,
    institution: "Example University", grade: 1.7, residence: "DE", citizenship: "XK",
    experience_months: 6, milestone: "exchange" };
  const representative: Profile = { facts: Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, fact(value)])) };
  const synthetic: MatchCall = { id: "representative-synthetic", recommendation_ready: true, serving_state: "ready",
    requirements: Object.entries(facts).map(([key, value]) => ({ id: key, fact_key: key, kind: "required", label: key,
      operator: key === "grade" ? "between" : "eq", expected: key === "grade" ? [1, 2.5] : value })),
    routes: [{ id: "route", availability_status: "available" }], windows: [{ state: "open" }] };
  assert.equal(recommend([synthetic], representative)[0].actionable, true);
  assert.deepEqual(recommend([synthetic], representative), pythonRecommend([synthetic], representative));
  for (const key of Object.keys(facts)) {
    const missing = structuredClone(representative);
    missing.facts![key] = fact(null, "prefer_not_to_say");
    const result = recommend([synthetic], missing)[0];
    assert.equal(result.status, UNKNOWN, key);
    assert.equal(result.actionable, false, key);
    assert.ok(result.criteria.unknown.some(c => c.id === key));
  }
  const outside = structuredClone(representative); outside.facts!.grade = fact(2.6);
  assert.equal(recommend([synthetic], outside)[0].status, MISMATCH);
});
