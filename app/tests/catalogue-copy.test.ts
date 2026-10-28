import assert from "node:assert/strict";
import test from "node:test";
import { audienceText, componentAmountText, componentLabel, longDate, moneyText, subjectsText, timingText, universitiesText } from "../lib/catalogue-copy";

test("dates read as day, month and year; timestamps use the Berlin calendar day", () => {
  assert.equal(longDate("2026-10-31"), "31 October 2026");
  assert.equal(longDate("2027-04-01"), "1 April 2027");
  assert.equal(longDate("2026-10-14T22:30:00.000Z"), "15 October 2026");
  for (const value of ["", "soon", "2027-02-30", null, undefined]) assert.equal(longDate(value), null);
});

test("money says the range, the period and the duration only when the data says so", () => {
  assert.equal(moneyText({ min: 30000, max: 105000, currency: "EUR", frequency: "monthly" }), "€300 to €1,050 per month");
  assert.equal(moneyText({ min: "30000", max: "30000", currency: "eur", frequency: "monthly", durationMonths: 12 }), "€300 per month for 12 months");
  assert.equal(moneyText({ min: 30000, currency: "EUR" }), "From €300");
  assert.equal(moneyText({ max: 75000, currency: "EUR", frequency: "one_time" }), "Up to €750 one-time");
  assert.equal(moneyText({ min: 123456, max: 200000, currency: "EUR", frequency: "variable" }), "€1,234.56 to €2,000");
  assert.equal(moneyText({ min: 30000 }), "Amount on the provider page");
  assert.equal(moneyText({ min: 30000, currency: "not-a-code" }), "Amount on the provider page");
  assert.equal(moneyText({}), "Amount on the provider page");
});

test("timing reads in words and keeps the owner's wording for later rounds and country-specific deadlines", () => {
  assert.equal(timingText({ applicationStatus: "open", effectiveState: "open", deadlineOn: "2026-10-31" }), "Deadline 31 October 2026");
  assert.equal(timingText({ applicationStatus: "planned", effectiveState: "announced", deadlineOn: "2027-04-01" }), "Opens later · next deadline 1 April 2027");
  assert.equal(timingText({ applicationStatus: "not_announced", effectiveState: "provider_defined", deadlineOn: null }), "Deadline depends on your country or group");
  assert.equal(timingText({ applicationStatus: "rolling", deadlineOn: null }), "Applications accepted on a rolling basis");
  assert.equal(timingText({ applicationStatus: "open", deadlineOn: null }), "Timing on the provider page");
});

test("who it is for lists real study levels, subjects and universities and says when the page does not", () => {
  assert.equal(audienceText({ degreeLevels: ["master", "bachelor", "master"], subjects: ["computer_science"], institutions: ["Example University"], subjectScope: "selected", institutionScope: "selected" }),
    "Master's or Bachelor's students · Subjects: computer science · Example University");
  assert.equal(audienceText({ degreeLevels: [], subjects: [], institutions: [], subjectScope: "unknown", institutionScope: "unknown" }),
    "Study level not stated · Subject not stated on the official page · University not stated on the official page");
  assert.equal(subjectsText("all", []), "Any subject");
  assert.equal(subjectsText("selected", []), "Listed subjects only; see the official page");
  assert.equal(subjectsText("provider_decides", []), "Subjects decided by the provider");
  assert.equal(subjectsText("unknown", ["law", "economics", "history", "art", "music"]), "Subjects: law, economics, history and 2 more");
  assert.equal(universitiesText("all", []), "Any state-recognised university");
  assert.equal(universitiesText("selected", ["TU Munich", "LMU", "Uni Bonn"]), "TU Munich, LMU and 1 more");
});

test("a funding component reads as the provider states it: price, share, set by the provider, not published or in kind", () => {
  const base = { amount_kind: "exact", amount_min_minor: null, amount_max_minor: null, currency: null, percentage: null, frequency: "other",
    duration_min_months: null, duration_max_months: null };
  assert.equal(componentAmountText({ ...base, amount_min_minor: 99200, amount_max_minor: 99200, currency: "EUR", frequency: "monthly", duration_min_months: 12, duration_max_months: 36 }), "€992 per month for 12 to 36 months");
  assert.equal(componentAmountText({ ...base, amount_kind: "range", amount_min_minor: 30000, amount_max_minor: 105000, currency: "EUR", frequency: "monthly", duration_max_months: 24 }), "€300 to €1,050 per month for up to 24 months");
  assert.equal(componentAmountText({ ...base, amount_kind: "up_to", amount_max_minor: 50000, currency: "EUR", frequency: "per_trip" }), "Up to €500 per trip");
  assert.equal(componentAmountText({ ...base, amount_kind: "exact", amount_min_minor: 27600, amount_max_minor: 27600, currency: "EUR", frequency: "monthly", duration_min_months: 1, duration_max_months: 1 }), "€276 per month for 1 month");
  assert.equal(componentAmountText({ ...base, amount_kind: "exact", amount_min_minor: 10000, amount_max_minor: 10000, currency: "EUR", frequency: "yearly", duration_min_months: 6 }), "€100 per year for at least 6 months");
  assert.equal(componentAmountText({ ...base, amount_kind: "provider_defined" }), "Amount set by the provider");
  assert.equal(componentAmountText({ ...base, amount_kind: "provider_defined", percentage: 50, frequency: "semester" }), "50% per semester");
  assert.equal(componentAmountText({ ...base, amount_kind: "not_published", frequency: "monthly" }), "Amount not published");
  assert.equal(componentAmountText({ ...base, amount_kind: "in_kind", frequency: "in_kind" }), "In kind");
  // An amount kind that promises a price without one falls back to the provider's wording.
  assert.equal(componentAmountText({ ...base, amount_kind: "exact", frequency: "monthly" }), "Amount set by the provider");
  assert.equal(componentLabel("living_stipend"), "Living stipend");
  assert.equal(componentLabel("family_allowance"), "Family allowance");
  assert.equal(componentLabel("unexpected"), "Other benefit");
});
