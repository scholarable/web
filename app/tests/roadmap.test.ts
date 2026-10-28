import assert from "node:assert/strict";
import test from "node:test";
import { roadmapSections } from "../lib/roadmap";
import type { Recommendation } from "../lib/contracts";

const result = (status: Recommendation["status"], actionable = false): Recommendation => ({
  call_id: status, track_id: null, route_id: null, status, visible: true, actionable,
  window_state: actionable ? "open" : "unknown", preference_matches: 0,
  criteria: { matched: [], mismatched: [], unknown: [] }, title: status, slug: status,
  routeAvailable: actionable, openingOn: null, deadline: null, source: null,
});

test("roadmap separates confirmed, unknown and hard-mismatch results", () => {
  const sections = roadmapSections([result("mismatch"), result("needs_confirmation"), result("match", true)]);
  assert.deepEqual(sections.map(section => section.id), ["apply", "check", "not-match"]);
  assert.deepEqual(sections.map(section => section.items[0].status), ["match", "needs_confirmation", "mismatch"]);
  assert.match(sections[2].description, /Correct an answer/);
});
