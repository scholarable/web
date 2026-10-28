import assert from "node:assert/strict";
import test from "node:test";
import { callDisplayTitle, providerDisplayName } from "../lib/provider-names";
import { browseServingCalls, servingCall, servingQuery } from "../lib/serving.server";

// Owner, 2026-10-28 ("do all"): the German site showed 32 DAAD calls under
// "German Academic Exchange Service (DAAD)", plus "University of Hamburg" and
// "Technical University of Munich (TUM)". Names from the live list.
test("a provider's English name is shown as the German name its own German page states", () => {
  assert.equal(providerDisplayName("German Academic Exchange Service (DAAD)"), "Deutscher Akademischer Austauschdienst (DAAD)");
  assert.equal(providerDisplayName("Technical University of Munich (TUM)"), "Technische Universität München (TUM)");
  assert.equal(providerDisplayName("University of Hamburg"), "Universität Hamburg");
  assert.equal(providerDisplayName(" University of Hamburg "), "Universität Hamburg");
  // German names and official names in English stay as stored.
  for (const name of ["Universität zu Köln", "Dresden International University", "WHU – Otto Beisheim School of Management", "SRH Fernhochschule – The Mobile University"])
    assert.equal(providerDisplayName(name), name);
});

test("an English Deutschlandstipendium title is shown as the programme and the provider's German name", () => {
  const english: [string, string, string][] = [
    ["Deutschlandstipendium at the University of Cologne, next round (funding from winter semester 2027/28)", "Universität zu Köln",
      "Deutschlandstipendium – Universität zu Köln"],
    ["Deutschlandstipendium at the University of Würzburg, next round (funding from 1 October 2027)", "Julius-Maximilians-Universität Würzburg",
      "Deutschlandstipendium – Julius-Maximilians-Universität Würzburg"],
    ["Deutschlandstipendium at the University of Konstanz, Summer Semester 2027 (presumably up to 40 scholarships)", "Universität Konstanz",
      "Deutschlandstipendium – Universität Konstanz"],
    ["Deutschlandstipendium at IU Internationale Hochschule (rounds for the summer and winter semester)", "IU Internationale Hochschule",
      "Deutschlandstipendium – IU Internationale Hochschule"],
    ["Deutschlandstipendium at FAU, winter semester 2027/2028", "Friedrich-Alexander-Universität Erlangen-Nürnberg",
      "Deutschlandstipendium – Friedrich-Alexander-Universität Erlangen-Nürnberg"],
    // The year right after the programme is kept; the dash needs no declension.
    ["Deutschlandstipendium 2027/28 at TU Dortmund University", "Technische Universität Dortmund",
      "Deutschlandstipendium 2027/28 – Technische Universität Dortmund"],
  ];
  for (const [title, provider, shown] of english) assert.equal(callDisplayTitle(title, provider), shown);
  // German titles, other programmes and calls without a provider stay as stored.
  const kept: [string, string | null][] = [
    ["Deutschlandstipendium – Ausschreibung 2026", "University of Hamburg"],
    ["TUM Deutschlandstipendium, Förderjahr 2027/28", "Technical University of Munich (TUM)"],
    ["UDE-Stipendium (Deutschlandstipendium) an der Universität Duisburg-Essen, Förderjahr 2027/28", "Universität Duisburg-Essen"],
    ["Deutschlandstipendium an der Charité, Bewerbungszeitraum Dezember 2026 (Förderstart 1. April 2027)", "Charité – Universitätsmedizin Berlin"],
    ["Graduation Scholarship, Winter Semester 2026/27", "Friedrich-Alexander-Universität Erlangen-Nürnberg"],
    ["Study Scholarships - Master Studies for All Academic Disciplines, funding starting 2027", "German Academic Exchange Service (DAAD)"],
    ["Deutschlandstipendium at the University of Cologne", null],
  ];
  for (const [title, provider] of kept) assert.equal(callDisplayTitle(title, provider), title);
});

test("the list cards and the detail page header show the German provider name and title", async () => {
  const env = { SCHOLARABLE_SERVING_DATABASE_URL: "synthetic-test-boundary" };
  const daad = { id: "1", slug: "daad", title: "Research Grants in Germany, 2027", application_status: "open", provider_name: "German Academic Exchange Service (DAAD)" };
  const dortmund = { id: "2", slug: "dortmund", title: "Deutschlandstipendium 2027/28 at TU Dortmund University", application_status: "planned",
    provider_name: "Technische Universität Dortmund" };
  const connect = async () => (async (sql: string) => sql.includes("as subject") ? [] : [daad, dortmund]) as unknown as Awaited<ReturnType<typeof servingQuery>>;
  const list = await browseServingCalls(new URL("https://example.test/scholarships"), env, connect);
  if (list.state !== "ready") assert.fail("synthetic catalogue unavailable");
  assert.deepEqual(list.scholarships.map(item => [item.provider, item.title]), [
    ["Deutscher Akademischer Austauschdienst (DAAD)", "Research Grants in Germany, 2027"],
    ["Technische Universität Dortmund", "Deutschlandstipendium 2027/28 – Technische Universität Dortmund"],
  ]);
  // The detail row carries the provider inside its details.
  const hamburg = { id: "3", slug: "hamburg", title: "Hamburglobal, Bewerbungsrunden Oktober 2026 und März 2027", application_status: "open",
    details: { provider_name: "University of Hamburg" } };
  const detail = await servingCall("hamburg", env, async () => (async () => [hamburg]) as unknown as Awaited<ReturnType<typeof servingQuery>>);
  if (detail.state !== "ready") assert.fail("synthetic call unavailable");
  assert.equal(detail.scholarship.provider, "Universität Hamburg");
  assert.equal(detail.scholarship.title, hamburg.title);
});
