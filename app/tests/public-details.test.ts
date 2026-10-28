import assert from "node:assert/strict";
import test from "node:test";
import { officialHttpsUrl, publicDetails, publicEligibility, publicFunding, studyScope, studyScopeText } from "../lib/public-details";

test("official navigation rejects executable, insecure and credential-bearing URLs", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,test", "http://example.org", "//example.org", "https://user:password@example.org", "https://example.org\\@evil.test", "https://exa mple.org", null]) assert.equal(officialHttpsUrl(url), null);
  assert.equal(officialHttpsUrl("https://example.org/apply?year=2026"), "https://example.org/apply?year=2026");
  assert.deepEqual(publicDetails(null), { provider_name: null, sources: [], funding: [], routes: [], tracks: [], windows: [], study_scope: { institutions: "unknown", subjects: "unknown" }, eligibility: { has_unshown_requirements: false, requirements: [], groups: [] } });
  const result = publicDetails({ sources: [{ label: "Official source", url: "https://example.org" }, { label: "Unsafe", url: "javascript:alert(1)" }], routes: [{ id: "1", label: "Email route", url: "mailto:private@example.org" }] });
  assert.equal(result.sources.length, 1);
  assert.equal(result.routes[0].url, null);
});

test("eligibility projection shows only general labels, nests grouped rules and flags what it cannot place", () => {
  const payload = { groups: [
    { id: "g1", logic: "any", applies_to: "application", track_id: "t1" },
    { id: "g2", logic: "all", applies_to: "renewal", parent_id: "g1" },
  ], requirements: [
    { id: "r1", group_id: "g1", track_id: "t1", label: "Study at the named institution", kind: "required", value: { expected: "private-value" }, evidence_locator: "internal" },
    { id: "r2", label: "Sensitive fact", kind: "manual_review", is_sensitive: true },
    { id: "r3", group_id: "missing", label: "Orphaned group stays unshown", kind: "required" },
    { id: "r4", group_id: "g2", label: "Nested renewal rule", kind: "exclusion" },
    { id: "bad", label: "Unsupported", kind: "invented" },
  ] };
  assert.deepEqual(publicEligibility(payload), {
    has_unshown_requirements: true,
    requirements: [
      { id: "r2", track_id: null, label: "Sensitive fact", kind: "manual_review" },
    ],
    groups: [{ id: "g1", track_id: "t1", logic: "any", applies_to: "application",
      requirements: [{ id: "r1", track_id: "t1", label: "Study at the named institution", kind: "required" }],
      groups: [{ id: "g2", track_id: null, logic: "all", applies_to: "renewal",
        requirements: [{ id: "r4", track_id: null, label: "Nested renewal rule", kind: "exclusion" }], groups: [] }] }],
  });
  assert.equal(JSON.stringify(publicEligibility(payload)).includes("private-value"), false);
  // Without the orphan, everything is placed and nothing is flagged.
  assert.equal(publicEligibility({ ...payload, requirements: payload.requirements.filter(rule => rule.id !== "r3") }).has_unshown_requirements, false);
  // A cycle, a duplicated group id and an invented logic keep the page honest.
  assert.equal(publicEligibility({ groups: [{ id: "a", logic: "all", parent_id: "b" }, { id: "b", logic: "all", parent_id: "a" }], requirements: [] }).has_unshown_requirements, true);
  assert.equal(publicEligibility({ groups: [{ id: "a", logic: "all" }, { id: "a", logic: "any" }], requirements: [] }).has_unshown_requirements, true);
  assert.equal(publicEligibility({ groups: [{ id: "a", logic: "most" }], requirements: [] }).has_unshown_requirements, true);
  assert.deepEqual(publicEligibility({ groups: Array(101).fill({}), requirements: [] }), { has_unshown_requirements: true, requirements: [], groups: [] });
});

test("an unstated study scope reads as not stated, never as all", () => {
  assert.equal(studyScopeText(studyScope("unknown"), "subjects"), "Not stated by the provider; check the official page");
  assert.equal(studyScopeText(studyScope("anything"), "universities"), "Not stated by the provider; check the official page");
  assert.equal(studyScopeText(studyScope("all"), "subjects"), "All subjects");
  assert.match(studyScopeText(studyScope("selected"), "universities"), /Only the listed universities/);
  assert.deepEqual(publicDetails(null, undefined, { institution_scope: "all", subject_scope: "unknown" }).study_scope,
    { institutions: "all", subjects: "unknown" });
});


test("partial route metadata renders safely without inventing availability", () => {
  const result = publicDetails({ routes: [null, { id: "route", label: "Official route", url: "https://example.org/apply" }] });
  assert.deepEqual(result.routes, [{ id: "route", label: "Official route", url: "https://example.org/apply", track_id: null, route_type: "unspecified", availability_status: "unknown" }]);
});

test("funding components keep only well-formed, currency-backed prices and never the evidence locator", () => {
  const stipend = { id: "c1", track_id: null, condition_group_id: null, component_type: "living_stipend", amount_kind: "exact", amount_min_minor: 99200,
    amount_max_minor: 99200, currency: "eur", percentage: null, frequency: "monthly", duration_min_months: 12, duration_max_months: 36,
    starts_on: "2027-10-01", ends_on: null, is_conditional: false, description: "  Basic stipend. ", evidence_locator: "internal" };
  const parsed = publicFunding([
    stipend,
    { ...stipend, id: "c2", component_type: "mentoring", amount_kind: "in_kind", amount_min_minor: null, amount_max_minor: null, currency: null, frequency: "in_kind", is_conditional: "yes" },
    { ...stipend, id: "c3", amount_min_minor: 50000, currency: null }, // a price without a currency is not shown as a price
    { ...stipend, id: "c4", amount_min_minor: 90000, amount_max_minor: 10000 }, // inverted range
    { ...stipend, id: "c5", component_type: "bonus" }, // unknown kind
    { ...stipend, id: "c6", description: "" },
    { ...stipend, id: "c7", track_id: 42 },
    "not an object",
  ]);
  assert.deepEqual(parsed.map(component => component.id), ["c1", "c2", "c3"]);
  assert.equal(parsed[0].description, "Basic stipend.");
  assert.equal(parsed[0].currency, "EUR");
  assert.deepEqual([parsed[0].duration_min_months, parsed[0].duration_max_months, parsed[0].starts_on], [12, 36, "2027-10-01"]);
  assert.equal(parsed[1].is_conditional, false);
  assert.deepEqual([parsed[2].amount_min_minor, parsed[2].currency], [null, null]);
  assert.equal(JSON.stringify(parsed).includes("evidence_locator"), false);
  assert.deepEqual(publicFunding(Array(101).fill(stipend)), []);
  assert.deepEqual(publicFunding("nope"), []);
  assert.deepEqual(publicDetails({ funding: [stipend] }).funding.length, 1);
});
