import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import test from "node:test";
import { arrangeList, CardList, familyLead, ownCall } from "../components/scholarship-list";
import { institutionNote } from "../components/discovery-chat";
import { loader as chooser } from "../routes/hochschule";
import { cardFacts } from "../lib/cards";
import { NOT_LISTED } from "../lib/study-fit";
import type { MatchResult, Recommendation } from "../lib/contracts";
import type { ScholarshipListItem } from "../lib/serving.server";

// The Deutschlandstipendium is one call per university: a student can only
// apply at their own, so the list shows the family once (owner decision 2026-10-26).
const today = "2026-10-26";
const flat = (minor: number) => [{ id: "flat", track_id: null, condition_group_id: null, component_type: "other", amount_kind: "exact", amount_min_minor: minor, amount_max_minor: minor,
  currency: "EUR", percentage: null, frequency: "monthly", duration_min_months: null, duration_max_months: null, starts_on: null, ends_on: null, is_conditional: false, description: "Monatlich." }];
type Shape = { deadline?: string | null; status?: string; opens?: string; levels?: string[]; applyNow?: boolean; family?: string | null; provider?: string; institutions?: string[]; minor?: number };
function item(id: string, { deadline = "2026-11-30", status = "open", opens, levels = ["bachelor"], applyNow = status === "open", family = null, provider = `Hochschule ${id}`, institutions = [], minor = 30000 }: Shape = {}): ScholarshipListItem {
  const window = { id: "w", window_type: "application", deadline_on: deadline, deadline_precision: deadline ? "date_only" : "unknown", ...(opens ? { opens_on: opens, opens_precision: "date_only" } : {}) };
  return { id, slug: `deutschlandstipendium-${id}`, title: `Deutschlandstipendium an der ${provider}`, provider, funding: "", deadline: "", audience: "", status: "open", lastChecked: null, applyNow, family, institutions, subjects: [], origins: [],
    card: cardFacts({ funding: flat(minor), tracks: [], windows: [window], applicationStatus: status, effectiveState: null, deadlineOn: deadline, summaryMoney: {}, levels, levelRuleIds: levels.length ? ["level"] : [],
      subjectScope: "all", institutionScope: family ? "selected" : "all" }, today) };
}
// Each university's call names its university (call_institutions), as every live one does.
const ds = (id: string, shape: Shape = {}) => item(id, { family: "deutschlandstipendium", institutions: [shape.provider || `Hochschule ${id}`], ...shape });
const html = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(RouterProvider, { router: createMemoryRouter([{ path: "/", element }]) }));
const noSave = { studentAccounts: false, signedIn: false, savedIds: [] };
const recommendation = (callId: string, status: Recommendation["status"], matched: string[], mismatched: string[] = []): Recommendation => ({
  call_id: callId, track_id: null, route_id: null, status, visible: true, actionable: false, window_state: "open", preference_matches: 0, title: "", slug: "", routeAvailable: true, openingOn: null, deadline: null, source: null,
  criteria: { matched: matched.map(id => ({ id, label: "Studium", kind: "required", status: "match", reason: "matched" })),
    mismatched: mismatched.map(id => ({ id, label: "Promotion ausgeschlossen", kind: "exclusion", status: "mismatch", reason: "mismatch" })), unknown: [] },
} as Recommendation);
const catalogue = () => [
  item("fes", { deadline: "2026-10-31", provider: "Friedrich-Ebert-Stiftung", minor: 99200 }),
  ds("hfm", { deadline: "2026-10-30", provider: "Hochschule für Musik Dresden" }),
  ds("tud", { deadline: "2027-07-15", status: "planned", opens: "2027-05-01", provider: "Technische Universität Dresden", institutions: ["TU Dresden"] }),
  ds("tum", { deadline: null, status: "not_announced", provider: "Technical University of Munich (TUM)", institutions: ["TUM"], levels: [] }),
  ds("adbk", { deadline: "2026-11-03", provider: "Akademie der Bildenden Künste München" }),
  item("daad", { deadline: null, status: "not_announced", provider: "DAAD", levels: ["master"] }),
];

test("one grouped card stands where its best member would, counts the members and offers the chooser without script", () => {
  const items = catalogue();
  const { shown } = arrangeList(items, null);
  assert.deepEqual(shown.map(entry => entry.kind === "family" ? `family:${entry.family}:${entry.members.length}` : entry.item.id), ["family:deutschlandstipendium:4", "fes", "daad"]);
  assert.equal(familyLead(items.filter(entry => entry.family)).id, "hfm", "open now with the earliest deadline leads");
  const page = html(createElement(CardList, { items, result: null, level: null, save: noSave }));
  assert.match(page, /<h2 class="group-h" id="group-open">Jetzt offen <span class="count">2<\/span><\/h2>/, "the family counts once among the cards");
  assert.match(page, /<li class="card family"><div class="card-name"><h3>Deutschlandstipendium<\/h3><p class="call-title">an 4 Hochschulen · jede vergibt es selbst, mit eigenen Fristen und Regeln<\/p>/);
  assert.match(page, /<span class="pill urgent">noch 4 Tage<\/span><span class="when">2 von 4 gerade offen<\/span><span class="sub">nächste Frist 30\. Okt\.<\/span>/);
  assert.match(page, /<span class="num">300 €<small> \/ Monat<\/small><\/span>/);
  const form = page.match(/<form class="pick-uni" action="\/hochschule" method="get">(.*?)<\/form>/)?.[1] || "";
  assert.match(form, /<label>Wähle deine Hochschule<select name="call" required=""><option value="" selected="">Hochschule auswählen …<\/option>/);
  assert.deepEqual([...form.matchAll(/<option value="deutschlandstipendium-(\w+)">/g)].map(match => match[1]), ["adbk", "hfm", "tum", "tud"], "universities in alphabetical order");
  assert.match(form, /<button class="btn dark sm">Zu meiner Hochschule<\/button>/);
  assert.match(page, /<a class="btn link" href="\/scholarships\?family=deutschlandstipendium"[^>]*>Alle 4 einzeln ansehen<\/a>/);
  assert.doesNotMatch(page, /Deutschlandstipendium an der Technische Universität Dresden/, "no member card of its own");
  assert.doesNotMatch(page, /<a[^>]*href="\/scholarships\/deutschlandstipendium-hfm"/);
  // No member open: the card stands where the earliest opening member would.
  const later = items.map(entry => entry.family ? { ...entry, applyNow: false, card: ds(entry.id, { deadline: "2027-07-15", status: "planned", opens: "2027-05-01" }).card } : entry);
  assert.match(html(createElement(CardList, { items: later, result: null, level: null, save: noSave })), /id="group-soon">Öffnet bald <span class="count">1<\/span>.*?<li class="card family">.*?<span class="pill later">öffnet 1\. Mai 2027<\/span><span class="when"><\/span>/s);
});

test("a search or the family filter lists the members call by call", () => {
  const items = catalogue();
  const page = html(createElement(CardList, { items, result: null, level: null, save: noSave, grouped: false }));
  assert.doesNotMatch(page, /card family/);
  assert.match(page, /href="\/scholarships\/deutschlandstipendium-hfm"/);
  assert.match(page, /href="\/scholarships\/deutschlandstipendium-tud"/);
  assert.match(page, /id="group-open">Jetzt offen <span class="count">3<\/span>/);
});

test("the chat's university puts that university's call in the list and folds the other universities' card away", () => {
  const items = catalogue();
  assert.equal(ownCall(items.filter(entry => entry.family), "tu dresden")?.id, "tud", "a verified institution name counts too");
  assert.equal(ownCall(items.filter(entry => entry.family), "Universität Rostock"), null);
  assert.equal(ownCall(items.filter(entry => entry.family), NOT_LISTED), null);
  // "TU Dresden" is a chooser name: the other members are surely other universities'.
  const own = html(createElement(CardList, { items, result: null, level: null, save: noSave, institution: "TU Dresden" }));
  const [main, folded] = own.split('<details class="mismatch-group">');
  assert.match(main, /href="\/scholarships\/deutschlandstipendium-tud"/);
  assert.match(main, /id="group-soon">Öffnet bald <span class="count">1<\/span>/);
  assert.match(main, /<span class="who-tag on">Deine Hochschule<\/span>/);
  assert.doesNotMatch(main, /card family|deutschlandstipendium-hfm|deutschlandstipendium-tum|deutschlandstipendium-adbk/, "the other universities' calls are not in the list");
  assert.match(folded, /^<summary>Nur für Studierende anderer Hochschulen \(1\)<\/summary>/);
  assert.match(folded, /<li class="card family">.*an 3 Hochschulen/s, "nothing silently hidden: the other members fold away as one card");
  assert.doesNotMatch(folded, /deutschlandstipendium-tud"/);
  assert.equal(institutionNote(items, "TU Dresden"), "Für TU Dresden steht das Deutschlandstipendium deiner Hochschule jetzt in der Liste. Die anderen Hochschulen stehen ganz unten, eingeklappt.");
  // The provider's name finds the own call too; the site does not know it as a
  // university name, so it cannot be sure about the others and keeps their card.
  const provider = html(createElement(CardList, { items, result: null, level: null, save: noSave, institution: "Technische Universität Dresden" }));
  assert.match(provider, /href="\/scholarships\/deutschlandstipendium-tud"/);
  assert.match(provider, /<li class="card family">.*an 3 Hochschulen/s);
  assert.doesNotMatch(provider, /mismatch-group/);
  // A university without a listed call ("nicht dabei" or a known name): the whole card folds away and the chat says so.
  for (const answer of [NOT_LISTED, "DAAD"]) {
    const none = html(createElement(CardList, { items: answer === "DAAD" ? [...items, item("own", { provider: "DAAD", institutions: ["DAAD"] })] : items, result: null, level: null, save: noSave, institution: answer }));
    assert.match(none.split('<details class="mismatch-group">')[1] || "", /<li class="card family">.*an 4 Hochschulen/s, answer);
  }
  assert.equal(institutionNote(items, NOT_LISTED), "Für deine Hochschule haben wir das Deutschlandstipendium noch nicht geprüft. Die anderen Hochschulen stehen ganz unten, eingeklappt.");
  assert.equal(institutionNote(items, "Universität Rostock"), "Ob deine Hochschule beim Deutschlandstipendium dabei ist, kann ich nicht sicher sagen. Wähl sie in der Übersicht in der Liste.");
  assert.equal(institutionNote(items, ""), "Okay. Das Deutschlandstipendium zeige ich dir dann als Übersicht aller Hochschulen in der Liste.");
  assert.equal(institutionNote([items[0], items[5]], "Universität Rostock"), null, "nothing to say without a family in the list");
});

test("with a study level the card counts the universities whose rules name it; conflicts fold the card away", () => {
  const items = catalogue();
  const result = { recommendations: [recommendation("hfm", "needs_confirmation", ["level"]), recommendation("tud", "needs_confirmation", ["level"]), recommendation("tum", "needs_confirmation", []),
    recommendation("adbk", "mismatch", [], ["level"]), recommendation("fes", "needs_confirmation", ["level"]), recommendation("daad", "mismatch", [], ["level"])] } as MatchResult;
  const page = html(createElement(CardList, { items, result, level: "bachelor", save: noSave }));
  assert.match(page, /an 3 Hochschulen/, "a member whose rules conflict is not counted");
  assert.match(page, /<span class="who-tag fit ok">Bachelor passt bei 2 von 3<\/span>/);
  assert.match(page, /<details class="mismatch-group"><summary>Passt laut Regeln nicht zu deinen Angaben \(2\)/);
  assert.match(page, /deutschlandstipendium-adbk/);
  const { conflicts, shown } = arrangeList(items, { recommendations: result.recommendations.map(entry => entry.call_id === "fes" ? entry : recommendation(entry.call_id, "mismatch", [], ["level"])) } as MatchResult);
  assert.deepEqual(shown.map(entry => entry.kind === "call" ? entry.item.id : "family"), ["fes"]);
  assert.deepEqual(conflicts.map(entry => entry.kind === "family" ? `family:${entry.members.length}` : entry.item.id), ["family:4", "daad"], "every university conflicting: the family card folds away whole");
  // The level filter (a link, no chat) counts the stated levels.
  const filtered = html(createElement(CardList, { items, result: null, level: null, filterLevel: "bachelor", save: noSave }));
  assert.match(filtered, /<span class="who-tag on">Bachelor<\/span>/);
});

test("the chooser leads to the chosen university's page before the script loads", async () => {
  const where = async (query: string) => (await chooser({ request: new Request(`https://scholarable.de/hochschule${query}`), params: {}, context: {} } as never) as Response).headers.get("location");
  assert.equal(await where("?call=deutschlandstipendium-2027-28-647269894c41"), "/scholarships/deutschlandstipendium-2027-28-647269894c41");
  assert.equal(await where("?call=../account"), "/scholarships");
  assert.equal(await where(""), "/scholarships");
});
