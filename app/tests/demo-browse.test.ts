import assert from "node:assert/strict";
import test from "node:test";
import { browseFilters, mentionedValues, PAGE_SIZE } from "../lib/browse";
import { demoBrowse, demoCalls } from "../lib/demo-catalogue.server";

test("combined synthetic browse filters and empty recovery work, and every match is loaded for the page to sort and page", () => {
  const filters = browseFilters(new URL("https://example.test/?degree=bachelor&subject=computer_science&status=open&q=undergraduate"));
  assert.deepEqual(demoBrowse(filters).scholarships.map(row => row.id), ["demo-bachelor"]);
  assert.equal(demoBrowse({ ...filters, subject: "engineering" }).scholarships.length, 0);
  const calls = Array.from({ length: 2 * PAGE_SIZE + 1 }, (_, index) => ({ ...demoCalls[0], id: `test-${index}` }));
  for (const page of [0, 2, 1000]) {
    const result = demoBrowse({ ...filters, page }, calls);
    assert.equal(result.scholarships.length, 2 * PAGE_SIZE + 1, "the list's page number never cuts the loaded calls");
    assert.equal(result.total, 2 * PAGE_SIZE + 1);
  }
  assert.equal(demoBrowse(browseFilters(new URL("https://example.test"))).scholarships.length, 4);
});

test("facets omit orphaned, negative or non-atomic criteria and retain scoped and positively grouped mentions without deciding eligibility", () => {
  const make = (extra: object) => ({ criterion_key: "subject", kind: "required", operator: "eq", value: { expected: "engineering" }, ...extra });
  assert.deepEqual(mentionedValues({ requirements: [make({ group_id: "renewal" }), make({ value: { expected: "engineering", note: "unsupported" } })] }, "subject"), []);
  assert.deepEqual(mentionedValues({ requirements: [make({ track_id: "other-track" })] }, "subject"), ["engineering"]);
  // An alternative inside an "any of" application group still names the subject; a "none of" group does not.
  assert.deepEqual(mentionedValues({ groups: [{ id: "either", logic: "any", applies_to: "application" }], requirements: [make({ group_id: "either" })] }, "subject"), ["engineering"]);
  assert.deepEqual(mentionedValues({ groups: [{ id: "not", logic: "none", applies_to: "application" }], requirements: [make({ group_id: "not" })] }, "subject"), []);
  const scoped = { ...demoCalls[0], matching_payload: { ...demoCalls[0].matching_payload, requirements: [
    { id: "a", label: "Degree", criterion_key: "degree_level", kind: "required", operator: "eq", value: { expected: "bachelor" }, track_id: "a" },
    { id: "b", label: "Subject", criterion_key: "subject", kind: "required", operator: "eq", value: { expected: "engineering" }, track_id: "b" },
  ] } };
  assert.equal(demoBrowse(browseFilters(new URL("https://example.test/?degree=bachelor&subject=engineering")), [scoped]).scholarships.length, 1);
});
