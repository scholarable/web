import assert from "node:assert/strict";
import test from "node:test";
import { reportDraft, reportHref, reportReference } from "../lib/reporting";

test("report links carry only bounded public call and verification references", () => {
  const reference = { callId: "42", version: "2026-09-13T00:00:00Z" };
  assert.deepEqual(reportReference(reference.callId, reference.version), reference);
  assert.equal(reportHref(reference), "/report?call=42&version=2026-09-13T00%3A00%3A00Z");
  for (const invalid of ["0", "-1", "1\r\nbcc:evil@example.com", "health-answer", "9".repeat(19)]) {
    assert.equal(reportReference(invalid, null), null);
    assert.equal(reportHref({ callId: invalid, version: null }), "/report");
  }
  assert.deepEqual(reportReference("42", "private-profile-fact"), { callId: "42", version: null });
});

test("draft targets fixed operator with no automatic delivery or arbitrary headers", () => {
  const draft = new URL(reportDraft({ callId: "42", version: null }, "stale"));
  assert.equal(draft.protocol, "mailto:");
  assert.equal(draft.pathname, "info@scholarable.de");
  assert.equal(draft.searchParams.get("subject"), "Scholarable catalogue report – Fehler in einem Stipendium");
  assert.match(draft.searchParams.get("body")!, /Stipendium: 42/);
  assert.deepEqual([...draft.searchParams.keys()], ["subject", "body"]);
  assert.throws(() => reportDraft(null, "__proto__" as never));
});

test("sample feedback preserves only known fictional references and never claims verification", () => {
  for (const callId of ["demo-bachelor", "demo-master", "demo-doctoral", "demo-exchange"]) {
    const reference = reportReference(callId, "2026-09-13T00:00:00Z");
    assert.deepEqual(reference, { callId, version: null });
    assert.equal(reportHref(reference!), `/report?call=${callId}`);
    const draft = new URL(reportDraft(reference, "other"));
    assert.match(draft.searchParams.get("body")!, /Erfundenes Beispiel/);
    assert.match(draft.searchParams.get("body")!, new RegExp(callId));
    assert.doesNotMatch(draft.searchParams.get("body")!, /2026-09-13/);
  }
  for (const invalid of ["demo-secret-profile", "demo-bachelor\r\nbcc:evil@example.com", "demo-bachelor?health=yes"]) {
    assert.equal(reportReference(invalid, null), null);
  }
});
