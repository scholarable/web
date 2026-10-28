import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { ScholarshipCard } from "../components/scholarship-list";
import { browseFilters, browseQuery } from "../lib/browse";
import { cardFacts } from "../lib/cards";
import { summary } from "../lib/serving.server";

const card = cardFacts({ funding: [], tracks: [], windows: [], applicationStatus: "planned", effectiveState: "announced", deadlineOn: null,
  summaryMoney: { min: 30000, max: 30000, currency: "EUR", frequency: "monthly" }, levels: [], levelRuleIds: [], subjectScope: "all", institutionScope: "all" }, "2026-10-25");
const render = (reviewOverdue: boolean) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ScholarshipCard, {
  item: { id: "6", slug: "fnf", title: "Begabtenförderung", provider: "Friedrich-Naumann-Stiftung", funding: "", deadline: "", audience: "", status: "planned",
    lastChecked: "2026-10-17T09:26:00Z", reviewOverdue, card, applyNow: false, family: null, institutions: [], subjects: [] },
  fit: null, level: null, save: { studentAccounts: false, signedIn: false, savedIds: [] } })));

test("a call whose scheduled re-check is overdue stays listed with a note", () => {
  const html = render(true);
  assert.match(html, /Zuletzt geprüft am 17\. Oktober 2026\. Bitte auf der Seite des Anbieters prüfen\./);
  assert.doesNotMatch(render(false), /Zuletzt geprüft am/);
});

test("the serving rows carry the overdue flag into the summary", () => {
  assert.equal(summary({ id: 6, slug: "fnf", review_overdue: true }).reviewOverdue, true);
  assert.equal(summary({ id: 6, slug: "fnf", review_overdue: false }).reviewOverdue, false);
  assert.equal(summary({ id: 6, slug: "fnf" }).reviewOverdue, false);
  assert.match(browseQuery(browseFilters(new URL("https://example.test/scholarships"))).text, /r\.review_overdue/);
});
