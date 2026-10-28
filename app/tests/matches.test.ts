import assert from "node:assert/strict";
import test from "node:test";
import { MATCHING_CAPACITY, matchesResponse, parseProfile, profileOptions, usesStudyPlan } from "../lib/matches.server";
import type { ServingPayload } from "../lib/matching";
import { roadmapSections } from "../lib/roadmap";
import { demoCalls } from "../lib/demo-catalogue.server";

const fact = (value: unknown, value_state = "known") => ({ value, value_state, confirmation_state: "confirmed" });
const input = () => ({ profile: { facts: {
  adult_confirmation: fact(true), institution: fact("Private test university"),
  degree_level: fact("bachelor"), subject: fact("Private test subject"),
  semester_number: fact(2), milestone: fact(null, "prefer_not_to_say"),
} } });
const request = (body: unknown = input(), origin = "https://scholarable.test") => new Request("https://scholarable.test/api/matches", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const payload: ServingPayload = {
  id: "call", recommendation_ready: true, serving_state: "ready",
  requirements: [{ id: "degree", criterion_key: "degree_level", kind: "required", operator: "eq", value: { expected: "bachelor" }, label: "Study level" }],
  routes: [{ id: "route", availability_status: "available" }],
  windows: [{ id: "window", state: "open" }],
};
const row = { id: "call", title: "Synthetic test call", slug: "test-call", matching_payload: payload };

test("catalogue choices preserve exact reviewed values and stale/unrecognised input stays unknown", async () => {
  const scoped = { ...row, matching_payload: { ...payload, requirements: [...payload.requirements!,
    { id: "subject", criterion_key: "subject", kind: "required", operator: "eq", value: { expected: "computer_science" }, label: "Subject" },
  ] } };
  assert.deepEqual(profileOptions([scoped]), { institution: [], subject: ["computer_science"], subjectInfo: {}, askAbroad: false });
  // "Wo studierst du?" offers every specific university a listed call names
  // (public_call_institutions): a declared family's universities (the
  // Stiftung Studienfonds OWL's Bielefeld and Paderborn, not the foundation) and
  // a university's own call's, under their German names. A call outside every
  // family offers nothing by its provider name alone, and another provider's
  // list (DAAD: a category, an English duplicate) adds nothing.
  const owl = { ...row, id: "owl", details: { provider_name: "Stiftung Studienfonds OWL" }, family: "deutschlandstipendium", institutions: ["Universität Paderborn", "Universität Bielefeld"] };
  const tum = { ...row, id: "tum", details: { provider_name: "Technical University of Munich (TUM)" }, family: "deutschlandstipendium", institutions: ["TUM"] };
  const fau = { ...row, id: "fau", details: { provider_name: "Friedrich-Alexander-Universität Erlangen-Nürnberg" }, family: null, institutions: ["Friedrich-Alexander-Universität Erlangen-Nürnberg"] };
  const hamburg = { ...row, id: "uhh", details: { provider_name: "University of Hamburg" }, family: null, institutions: ["Universität Hamburg"] };
  const daad = { ...row, id: "daad", details: { provider_name: "German Academic Exchange Service (DAAD)" }, family: null,
    institutions: ["German universities of applied sciences (HAW) and Fachhochschulen", "University of Passau"] };
  const other = { ...row, id: "fes", details: { provider_name: "Friedrich-Ebert-Stiftung" }, family: null };
  assert.deepEqual(profileOptions([other, owl, tum, fau, hamburg, daad]).institution,
    ["Friedrich-Alexander-Universität Erlangen-Nürnberg", "TUM", "Universität Bielefeld", "Universität Hamburg", "Universität Paderborn"]);
  // Subjects come from the taxonomy (public_call_subjects), with German names and Fächergruppen.
  const taxonomy = { ...row, id: "rise", taxonomy_tags: [{ code: "computer-science", name: "Informatik", group: "engineering", group_name: "Ingenieurwissenschaften" },
    { code: "mathematics-natural-sciences", name: "Mathematik, Naturwissenschaften", group: null, group_name: null }] };
  assert.deepEqual(profileOptions([taxonomy]), { institution: [], subject: ["computer-science", "engineering", "mathematics-natural-sciences"], subjectInfo: {
    "computer-science": { label: "Informatik", group: "engineering" }, engineering: { label: "Ingenieurwissenschaften", group: null },
    "mathematics-natural-sciences": { label: "Mathematik, Naturwissenschaften", group: null } }, askAbroad: false });
  // A taxonomy answer reaches matching; one the catalogue does not hold stays unknown.
  const chosen = input(); chosen.profile.facts.subject.value = "computer-science"; chosen.profile.facts.institution.value = "Universität Hamburg";
  const rows = [taxonomy, hamburg].map(entry => ({ ...entry, matching_payload: { ...payload, id: entry.id } }));
  assert.deepEqual((await (await matchesResponse(request(chosen), undefined, async () => rows)).json()).recommendations.map((item: { call_id: string }) => item.call_id).sort(), ["rise", "uhh"]);
  const typed = input(); typed.profile.facts.subject.value = "computer science";
  const result = await (await matchesResponse(request(typed), undefined, async () => [scoped])).json();
  assert.equal(result.recommendations[0].status, "needs_confirmation");
  assert.equal(result.recommendations[0].actionable, false);
  typed.profile.facts.subject.value = "computer_science";
  const matched = await (await matchesResponse(request(typed), undefined, async () => [scoped])).json();
  assert.equal(matched.recommendations[0].status, "match");
  typed.profile.facts.subject = fact(null, "unknown");
  assert.equal(parseProfile(typed).facts.subject.value_state, "unknown");
});

test("validates adult, finite semester, bounded text and atomic confirmed facts", () => {
  assert.equal(parseProfile(input()).facts.milestone.value_state, "prefer_not_to_say");
  for (const [key, value] of [["adult_confirmation", false], ["semester_number", 1.5], ["semester_number", Infinity], ["semester_number", 0], ["degree_level", "unsupported"], ["institution", " "], ["subject", "a".repeat(161)]] as const) {
    const bad = input(); bad.profile.facts[key].value = value;
    assert.throws(() => parseProfile(bad));
  }
  assert.throws(() => parseProfile({ ...input(), debug: true }));
  assert.throws(() => parseProfile({ profile: { facts: { ...input().profile.facts, extra: fact("hidden") } } }));
  const unconfirmed = input(); unconfirmed.profile.facts.degree_level.confirmation_state = "inferred";
  assert.throws(() => parseProfile(unconfirmed));
  const withheld = input(); withheld.profile.facts.milestone.value = "hidden answer";
  assert.throws(() => parseProfile(withheld));
});

test("rejects cross-origin, wrong method/type, malformed and oversized bodies before database access", async () => {
  const never = async () => { assert.fail("Database must not be queried"); };
  assert.equal((await matchesResponse(request(input(), "https://attacker.test"), undefined, never)).status, 403);
  assert.equal((await matchesResponse(new Request("https://scholarable.test/api/matches"), undefined, never)).status, 405);
  assert.equal((await matchesResponse(new Request("https://scholarable.test/api/matches", { method: "POST", headers: { Origin: "https://scholarable.test" }, body: "data" }), undefined, never)).status, 415);
  assert.equal((await matchesResponse(request({}), undefined, never)).status, 400);
  assert.equal((await matchesResponse(request("a".repeat(8200)), undefined, never)).status, 413);
});

test("removed degree and semester answers stay unknown and never become actionable", async () => {
  for (const key of ["degree_level", "semester_number"] as const) {
    const constrained = { ...row, matching_payload: { ...payload, requirements: [
      { id: key, criterion_key: key, kind: "required", operator: "eq", value: { expected: key === "degree_level" ? "bachelor" : 2 }, label: key },
    ] } };
    for (const state of ["unknown", "prefer_not_to_say"]) {
      const removed = input(); removed.profile.facts[key] = fact(null, state);
      const response = await matchesResponse(request(removed), undefined, async () => [constrained]);
      assert.equal(response.status, 200);
      const result = (await response.json()).recommendations[0];
      assert.equal(result.status, "needs_confirmation");
      assert.equal(result.actionable, false);
      removed.profile.facts[key].value = "hidden answer";
      assert.throws(() => parseProfile(removed));
    }
    const invalid = input(); invalid.profile.facts[key] = fact(null, "not_applicable");
    assert.throws(() => parseProfile(invalid));
  }
  const adult = input(); adult.profile.facts.adult_confirmation = fact(null, "unknown");
  assert.throws(() => parseProfile(adult));
});

test("serving result uses the real core and never echoes or persists profile values", async () => {
  let reads = 0;
  const response = await matchesResponse(request(), undefined, async () => { reads++; return [row]; });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const text = await response.text();
  assert.equal(text.includes("Private test"), false);
  assert.equal(text.includes("semester_number"), false);
  const result = JSON.parse(text).recommendations[0];
  assert.equal(result.status, "match"); assert.equal(result.actionable, true);
  assert.equal(result.call_id, "call"); assert.equal(result.route_id, "route");
  assert.equal(result.title, row.title); assert.equal(reads, 1);
  const mismatch = input(); mismatch.profile.facts.degree_level.value = "doctoral";
  const mismatched = await (await matchesResponse(request(mismatch), undefined, async () => [row])).json();
  assert.equal(mismatched.recommendations[0].status, "mismatch");
  assert.equal(mismatched.recommendations[0].actionable, false);
  assert.equal(mismatched.recommendations[0].criteria.mismatched[0].id, "degree");
  const unpublished = { ...row, matching_payload: { ...payload, recommendation_ready: false } };
  assert.deepEqual(await (await matchesResponse(request(), undefined, async () => [unpublished])).json(), { recommendations: [] });
});

test("roadmap uses only the selected reviewed window for upcoming timing", async () => {
  const upcoming = { ...row, id: "upcoming", slug: "upcoming", matching_payload: { ...payload, id: "upcoming", windows: [{ id: "future", state: "announced" }] },
    details: { windows: [{ id: "future", window_type: "application", opens_on: "2028-04-01", opens_precision: "date_only", deadline_on: "2028-05-26", deadline_precision: "date_only" }] } };
  const unchecked = { ...upcoming, id: "unchecked", slug: "unchecked", matching_payload: { ...upcoming.matching_payload, id: "unchecked" },
    details: { windows: [{ ...upcoming.details.windows[0], id: "different" }] } };
  const estimated = { ...upcoming, id: "estimated", slug: "estimated", matching_payload: { ...upcoming.matching_payload, id: "estimated" },
    details: { windows: [{ ...upcoming.details.windows[0], opens_precision: "estimated" }] } };
  const response = await (await matchesResponse(request(), undefined, async () => [row, upcoming, unchecked, estimated])).json();
  const sections = roadmapSections(response.recommendations);
  assert.deepEqual(sections.map((section) => [section.id, section.items.map((item) => item.call_id)]), [
    ["apply", ["call"]], ["prepare", ["upcoming"]], ["check", ["estimated", "unchecked"]],
  ]);
  assert.equal(response.recommendations.find((item: { call_id: string }) => item.call_id === "upcoming").openingOn, "2028-04-01");
  assert.equal(response.recommendations.find((item: { call_id: string }) => item.call_id === "unchecked").openingOn, null);
});

test("recommendation source links only expose safe official HTTPS URLs", async () => {
  const safe = { ...row, details: { sources: [{ label: "Provider rules", url: "https://provider.example.org/rules" }] } };
  const result = await (await matchesResponse(request(), undefined, async () => [safe])).json();
  assert.deepEqual(result.recommendations[0].source, { label: "Provider rules", url: "https://provider.example.org/rules" });
  const unsafe = { ...row, details: { sources: [{ label: "Unsafe", url: "javascript:alert(1)" }] } };
  const rejected = await (await matchesResponse(request(), undefined, async () => [unsafe])).json();
  assert.equal(rejected.recommendations[0].source, null);
});

test("sample roadmap changes with study level, subject, semester and plan", async () => {
  const student = input();
  student.profile.facts.institution.value = "Example University";
  student.profile.facts.subject.value = "computer_science";
  student.profile.facts.semester_number.value = 3;
  student.profile.facts.milestone = fact("exchange");
  const calls = async () => demoCalls;
  const recommended = async () => (await (await matchesResponse(request(student), undefined, calls)).json()).recommendations
    .filter((item: { status: string }) => item.status !== "mismatch").map((item: { call_id: string }) => item.call_id);
  assert.deepEqual(await recommended(), ["demo-bachelor", "demo-exchange"]);
  student.profile.facts.semester_number.value = 1;
  assert.deepEqual(await recommended(), ["demo-bachelor"]);
  student.profile.facts.semester_number.value = 3;
  student.profile.facts.milestone.value = "thesis";
  assert.deepEqual(await recommended(), ["demo-bachelor"]);
  student.profile.facts.degree_level.value = "master";
  student.profile.facts.subject.value = "engineering";
  assert.deepEqual(await recommended(), ["demo-master"]);
});

test("missing connection, catalogue overflow and read failures stay unavailable without leaking errors", async () => {
  assert.equal((await matchesResponse(request(), undefined)).status, 503);
  assert.equal((await matchesResponse(request(), undefined, async () => Array(MATCHING_CAPACITY + 1).fill(row))).status, 503);
  const response = await matchesResponse(request(), undefined, async () => { throw new Error("secret database details"); });
  assert.equal(response.status, 503); assert.equal((await response.text()).includes("secret"), false);
  const wrongId = { ...row, id: "different" };
  assert.equal((await matchesResponse(request(), undefined, async () => [wrongId])).status, 503);
});

test("progressive prompts revisit only unanswered, resolvable starter questions", async () => {
  const unfinished = input(); unfinished.profile.facts.degree_level = fact(null, "unknown");
  const response = await (await matchesResponse(request(unfinished), undefined, async () => [row])).json();
  assert.deepEqual(response.followUps, [{ field: "degree_level", label: "Check your study level" }]);
  assert.equal(response.recommendations[0].status, "needs_confirmation");
  unfinished.profile.facts.degree_level = fact(null, "prefer_not_to_say");
  const withheld = await (await matchesResponse(request(unfinished), undefined, async () => [row])).json();
  assert.equal(withheld.followUps, undefined);
  assert.equal(withheld.recommendations[0].status, "needs_confirmation");
  unfinished.profile.facts.degree_level = fact("bachelor");
  const corrected = await (await matchesResponse(request(unfinished), undefined, async () => [row])).json();
  assert.equal(corrected.followUps, undefined);
  assert.equal(corrected.recommendations[0].status, "match");
  unfinished.profile.facts.degree_level = fact("doctoral");
  const mismatch = await (await matchesResponse(request(unfinished), undefined, async () => [row])).json();
  assert.equal(mismatch.recommendations[0].status, "mismatch");
  assert.equal(mismatch.followUps, undefined);
});

test("matching asks at most one high-impact clarification at a time", async () => {
  const unfinished = input();
  unfinished.profile.facts.degree_level = fact(null, "unknown");
  unfinished.profile.facts.subject = fact(null, "unknown");
  const constrained = { ...row, matching_payload: { ...payload, requirements: [...payload.requirements!,
    { id: "subject", criterion_key: "subject", kind: "required", operator: "eq", value: { expected: "Private test subject" }, label: "Subject" },
  ] } };
  const response = await (await matchesResponse(request(unfinished), undefined, async () => [constrained])).json();
  assert.equal(response.followUps.length, 1);
});

test("follow-ups do not invent options, request sensitive fields, or claim to resolve unsupported rules", async () => {
  for (const [field, operator, expected] of [
    ["citizenship", "eq", "DE"], ["institution", "exists", true],
    ["degree_level", "unknown_operator", "bachelor"], ["degree_level", "gte", "bachelor"],
  ] as const) {
    const unfinished = input(); unfinished.profile.facts.degree_level = fact(null, "unknown");
    const synthetic = { ...row, matching_payload: { ...payload, requirements: [
      { id: "extra", criterion_key: field, kind: "required", operator, value: { expected }, label: "Synthetic condition" },
    ] } };
    const body = await (await matchesResponse(request(unfinished), undefined, async () => [synthetic])).json();
    assert.equal(body.followUps, undefined, field + operator);
    assert.equal(body.recommendations[0].status, "needs_confirmation");
  }
});

test("study plan stays hidden for absent, manual and unsupported rules", () => {
  assert.equal(usesStudyPlan([row]), false);
  assert.equal(usesStudyPlan([{ ...row, matching_payload: { ...payload,
    groups: [{ id: "renewal", logic: "all", applies_to: "renewal" }],
    requirements: [...payload.requirements!, { id: "plan", group_id: "renewal", criterion_key: "milestone", kind: "required", operator: "eq", value: { expected: "exchange" }, label: "Renewal plan" }],
  } }]), false);
  for (const [operator, expected, wanted] of [["eq", "exchange", true], ["manual", "exchange", false], ["gte", "exchange", false], ["any", null, false]] as const) {
    assert.equal(usesStudyPlan([{ ...row, matching_payload: { ...payload, requirements: [
      { id: "plan", criterion_key: "milestone", kind: "required", operator, value: { expected }, label: "Study plan" },
    ] } }]), wanted);
  }
});

test("follow-ups respect route groups, satisfied alternatives and ambiguous criterion IDs", async () => {
  const unfinished = input(); unfinished.profile.facts.degree_level = fact(null, "unknown");
  const degree = payload.requirements![0];
  const condition = { id: "plan", criterion_key: "milestone", kind: "required", operator: "eq", value: { expected: "exchange" }, label: "Plan" };
  // The unanswered degree belongs only to the unavailable route. The visible
  // route has a withheld plan and must not prompt for either answer.
  const routed = { ...row, matching_payload: { ...payload,
    groups: [{ id: "degree-route", logic: "all", applies_to: "application" }, { id: "plan-route", logic: "all", applies_to: "application" }],
    requirements: [{ ...degree, group_id: "degree-route" }, { ...condition, group_id: "plan-route" }],
    routes: [{ id: "hidden", availability_status: "unavailable", condition_group_id: "degree-route" }, { id: "visible", availability_status: "available", condition_group_id: "plan-route" }],
  } };
  assert.equal(usesStudyPlan([routed]), true);
  const routedResult = await (await matchesResponse(request(unfinished), undefined, async () => [routed])).json();
  assert.equal(routedResult.followUps, undefined);
  const alternatives = { ...row, matching_payload: { ...payload,
    groups: [{ id: "alternative", logic: "any" }],
    requirements: [{ ...degree, group_id: "alternative" }, { ...condition, operator: "any", group_id: "alternative" }],
  } };
  assert.equal(usesStudyPlan([alternatives]), false);
  const result = await (await matchesResponse(request(unfinished), undefined, async () => [alternatives])).json();
  assert.equal(result.recommendations[0].status, "match");
  assert.equal(result.followUps, undefined);
  const ambiguous = { ...row, matching_payload: { ...payload, requirements: [degree, { ...condition, id: degree.id }] } };
  const ambiguousResult = await (await matchesResponse(request(unfinished), undefined, async () => [ambiguous])).json();
  assert.equal(ambiguousResult.followUps, undefined);
});
