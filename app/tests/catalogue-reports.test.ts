import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedForm, submitCatalogueReport } from "../lib/catalogue-reports.server";
import { parseCatalogueReport, REPORT_NOTE_LIMIT } from "../lib/reporting";

const form = (entries: Record<string, string>) => new URLSearchParams(entries);
const post = (body: string) => new Request("https://students.scholarable.test/report", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
});

test("reports keep only a bounded public reference, a fixed reason and a short note", () => {
  const report = parseCatalogueReport(form({ call: "42", version: "2026-09-13T00:00:00Z", reason: "stale", note: "  Deadline on the site passed.\r\n" }));
  assert.deepEqual(report, { callId: "42", version: "2026-09-13T00:00:00Z", reason: "stale", note: "Deadline on the site passed." });
  assert.equal(parseCatalogueReport(form({ call: "42", reason: "incorrect" }))?.version, null);
  assert.equal(parseCatalogueReport(form({ call: "42", reason: "incorrect" }))?.note, "");
});

test("fictional samples, unknown reasons, oversized or control-character notes are rejected", () => {
  assert.equal(parseCatalogueReport(form({ call: "demo-bachelor", reason: "stale" })), null);
  assert.equal(parseCatalogueReport(form({ call: "42", reason: "spam" })), null);
  assert.equal(parseCatalogueReport(form({ call: "42", reason: "stale", note: "x".repeat(REPORT_NOTE_LIMIT + 1) })), null);
  assert.equal(parseCatalogueReport(form({ call: "42", reason: "stale", note: "bad\u0007bell" })), null);
  assert.equal(parseCatalogueReport(form({ call: "not-a-call", reason: "stale" })), null);
  assert.equal(parseCatalogueReport(form({ call: "42", version: "garbage", reason: "stale" }))?.version, null);
});

test("a full-length non-Latin note fits the streamed body limit; larger bodies are refused while reading", async () => {
  const note = "奖学金截止日期已过".repeat(50).slice(0, REPORT_NOTE_LIMIT);
  const body = form({ call: "42", reason: "stale", note }).toString();
  assert.ok(body.length > 4000, "percent-encoding should expand well beyond the decoded limit");
  const parsed = await readBoundedForm(post(body));
  assert.equal(parseCatalogueReport(parsed!)?.note, note);
  assert.equal(await readBoundedForm(post("note=" + "x".repeat(9000))), null);
});

test("without a serving database the report is reported as unavailable, never as stored", async () => {
  const outcome = await submitCatalogueReport({}, { callId: "42", version: null, reason: "stale", note: "" });
  assert.equal(outcome, "unavailable");
});
