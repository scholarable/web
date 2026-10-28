import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import test from "node:test";
import Match from "../routes/match";
import { institutionNote, questions, resultSummary, subjectOptions } from "../components/discovery-chat";
import { arrangeList, CardList } from "../components/scholarship-list";
import { PAGE_SIZE } from "../lib/browse";
import { cardFacts } from "../lib/cards";
import { matchRequest, type AnswersState } from "../lib/discovery-answers";
import { interpretGoal } from "../lib/discovery";
import type { MatchResult, Recommendation } from "../lib/contracts";
import type { ScholarshipListItem } from "../lib/serving.server";
import { NOT_LISTED, subjectFit, subjectGroups, universityChoices, universityFit, type SubjectTag } from "../lib/study-fit";

// The core student flow at 190 calls (2026-10-28): the chat and its list cover
// every listed call, the Deutschlandstipendium is one card before paging, and
// the university and subject answers sort and label calls that are only for some.
const today = "2026-10-28";
type Shape = { deadline?: string; levels?: string[]; family?: string | null; provider?: string; institutions?: string[]; institutionScope?: string; subjectScope?: string; subjects?: SubjectTag[]; applyNow?: boolean };
function call(id: string, { deadline = "2026-12-01", levels = [], family = null, provider = `Anbieter ${id}`, institutions = [], institutionScope = institutions.length ? "selected" : "all",
  subjectScope = "all", subjects = [], applyNow = true }: Shape = {}): ScholarshipListItem {
  const window = { id: "w", window_type: "application", deadline_on: deadline, deadline_precision: "date_only" };
  return { id, slug: `call-${id}`, title: `Ausschreibung ${id}`, provider, funding: "", deadline: "", audience: "", status: "open", lastChecked: null, applyNow, family, institutions, subjects,
    card: cardFacts({ funding: [], tracks: [], windows: [window], applicationStatus: "open", effectiveState: null, deadlineOn: deadline,
      summaryMoney: { min: 30000, max: 30000, currency: "EUR", frequency: "monthly" }, levels, levelRuleIds: levels.length ? ["level"] : [], subjectScope, institutionScope }, today) };
}
const ds = (id: string, university: string, deadline = "2026-12-01", levels: string[] = []) => call(id, { family: "deutschlandstipendium", provider: university, institutions: [university], deadline, levels });
const recommendation = (callId: string, matched: boolean): Recommendation => ({
  call_id: callId, track_id: null, route_id: null, status: "needs_confirmation", visible: true, actionable: false, window_state: "open", preference_matches: 0,
  title: "", slug: "", routeAvailable: true, openingOn: null, deadline: null, source: null,
  criteria: { matched: matched ? [{ id: "level", label: "Studium", kind: "required", status: "match", reason: "matched" }] : [], mismatched: [], unknown: [] },
} as Recommendation);
const resultFor = (items: ScholarshipListItem[]) => ({ recommendations: items.map(item => recommendation(item.id, item.card.levelRuleIds.length > 0)) }) as MatchResult;
const answers = (result: MatchResult, facts: AnswersState["facts"]) => ({ facts: { degree_level: "bachelor", ...facts }, adult: "yes", asked: [], chat: [], proposal: null, result, loading: false, error: null }) as AnswersState;
const html = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(RouterProvider, { router: createMemoryRouter([{ path: "/", element }]) }));
const noSave = { studentAccounts: false, signedIn: false, savedIds: [] };
const cards = (page: string) => [...page.matchAll(/<li class="card[^"]*">.*?(?:href="\/scholarships\/(call-[\w-]+)"|<h[34]>(Deutschlandstipendium)<\/h[34]>)/g)].map(match => match[1] || match[2]);

// 80 Deutschlandstipendium calls spread over the deadlines, LMU's last; 110
// other calls, the ones naming Bachelor with the latest deadlines.
function catalogue() {
  const items: ScholarshipListItem[] = [];
  for (let index = 0; index < 110; index++) {
    const day = String(1 + (index % 28)).padStart(2, "0");
    const deadline = index < 28 ? `2026-11-${day}` : `2027-${String(Math.floor(index / 28)).padStart(2, "0")}-${day}`;
    items.push(call(`c${index}`, { deadline, levels: index >= 90 ? ["bachelor"] : [] }));
  }
  for (let index = 0; index < 79; index++) items.push(ds(`ds${index}`, `Hochschule ${index}`, index % 2 ? "2026-11-15" : "2027-05-15"));
  items.push(ds("lmu-ds", "Ludwig-Maximilians-Universität München", "2027-06-30"));
  return items;
}

test("the chat and its counts cover every listed call, not the first page", () => {
  const items = catalogue();
  const result = resultFor(items);
  // 20 calls name Bachelor; the other 90 and the Deutschlandstipendium card (80 calls) state none.
  assert.equal(resultSummary(items, answers(result, {})), "20 Stipendien nennen Bachelor ausdrücklich, sie stehen jetzt oben. Bei 91 steht kein Studienniveau, sie kommen danach.");
  // LMU's Deutschlandstipendium is the 190th call by deadline, far beyond the old page of 100.
  assert.equal(institutionNote(items, "Ludwig-Maximilians-Universität München"),
    "Für Ludwig-Maximilians-Universität München steht das Deutschlandstipendium deiner Hochschule jetzt in der Liste. Die anderen Hochschulen stehen ganz unten, eingeklappt.");
});

test("sorted by fit first, then paged: the calls naming the level lead page one", () => {
  const items = catalogue();
  const pages = (page: number) => html(createElement(CardList, { items, result: resultFor(items), level: "bachelor", save: noSave, pages: { page, href: (n: number) => `/scholarships?page=${n}` } }));
  const first = pages(0), second = pages(1);
  assert.deepEqual(cards(first).slice(0, 20).sort(), Array.from({ length: 20 }, (_, index) => `call-c${90 + index}`).sort(), "the 20 Bachelor calls come first although their deadlines are the latest");
  assert.equal(cards(first).length, PAGE_SIZE);
  assert.equal(cards(first).length + cards(second).length, 111, "110 calls and one Deutschlandstipendium card, none twice");
  assert.match(first, /<span>Seite 1 von 2<\/span><a rel="next" href="\/scholarships\?page=1"[^>]*>Nächste Seite<\/a>/);
  assert.match(second, /<a rel="prev" href="\/scholarships\?page=0"[^>]*>Vorherige Seite<\/a><span>Seite 2 von 2<\/span>/);
  // A group continued on the next page keeps its whole count.
  assert.match(second, /id="group-unstated">Studienniveau nicht angegeben <span class="count">91<\/span>/);
  assert.match(pages(5), /Diese Seite gibt es nicht\. <a href="\/scholarships\?page=0"[^>]*>Zur ersten Seite<\/a>/);
});

test("the Deutschlandstipendium is one card for every member, placed by its best member, before paging", () => {
  const items = catalogue();
  const pages = [0, 1].map(page => html(createElement(CardList, { items, result: null, level: null, save: noSave, pages: { page, href: (n: number) => `/scholarships?page=${n}` } })));
  const family = pages.map(page => page.match(/<li class="card family">/g)?.length ?? 0);
  assert.deepEqual(family, [1, 0], "once, on page one: its open member with the nearest deadline (15 Nov) places it");
  assert.match(pages[0], /an 80 Hochschulen/);
  const chooser = pages[0].match(/<form class="pick-uni" action="\/hochschule" method="get">(.*?)<\/form>/)?.[1] || "";
  assert.equal(chooser.match(/<option value="call-/g)?.length, 80, "the chooser lists every member");
  assert.match(chooser, /<option value="call-lmu-ds">Ludwig-Maximilians-Universität München<\/option>/);
});

// The live shapes: LMU's and FAU's own calls, the Elsa-Neumann grant naming the
// four Berlin universities, DAAD lists with a category and an English
// duplicate, Goethe-Universität under two names, and a call open to all.
const lmuCatalogue = () => [
  call("lmu", { provider: "Ludwig-Maximilians-Universität München", institutions: ["Ludwig-Maximilians-Universität München"], levels: ["bachelor"] }),
  call("fau", { provider: "Friedrich-Alexander-Universität Erlangen-Nürnberg", institutions: ["Friedrich-Alexander-Universität Erlangen-Nürnberg"], levels: ["bachelor"] }),
  call("elsa", { provider: "Freie Universität Berlin", institutions: ["Freie Universität Berlin", "Humboldt-Universität zu Berlin", "Technische Universität Berlin", "Universität der Künste Berlin"], levels: ["bachelor"] }),
  call("haw", { provider: "German Academic Exchange Service (DAAD)", institutions: ["Duale Hochschule Baden-Württemberg", "German universities of applied sciences (HAW) and Fachhochschulen"], levels: ["bachelor"] }),
  call("passau-daad", { provider: "German Academic Exchange Service (DAAD)", institutions: ["University of Passau"], levels: ["bachelor"] }),
  call("passau", { provider: "Universität Passau", institutions: ["Universität Passau"], levels: ["bachelor"] }),
  call("goethe-promos", { provider: "Goethe-Universität Frankfurt am Main", institutions: ["Goethe-Universität Frankfurt am Main"], levels: ["bachelor"] }),
  ds("goethe-ds", "Goethe-Universität", "2026-12-01", ["bachelor"]),
  ds("lmu-ds", "Ludwig-Maximilians-Universität München", "2026-12-01", ["bachelor"]),
  ds("owl-ds", "Stiftung Studienfonds OWL", "2026-12-01", ["bachelor"]),
  call("all", { levels: ["bachelor"] }),
];

test("the chooser offers every specific university, and none from a DAAD list", () => {
  const items = lmuCatalogue();
  items[9] = { ...items[9], institutions: ["Universität Bielefeld", "Universität Paderborn"] };
  assert.deepEqual(universityChoices(items), ["Freie Universität Berlin", "Friedrich-Alexander-Universität Erlangen-Nürnberg", "Goethe-Universität", "Goethe-Universität Frankfurt am Main",
    "Humboldt-Universität zu Berlin", "Ludwig-Maximilians-Universität München", "Technische Universität Berlin", "Universität Bielefeld", "Universität der Künste Berlin",
    "Universität Paderborn", "Universität Passau"]);
});

test("with a university, another university's call folds away and is never Passt zu dir; unsure ones stay and say so", () => {
  const items = lmuCatalogue();
  const result = resultFor(items);
  const list = arrangeList(items, result, { institution: "Ludwig-Maximilians-Universität München" });
  const ids = (entries: typeof list.shown) => entries.map(entry => entry.kind === "family" ? `family:${entry.members.length}` : entry.item.id).sort();
  assert.deepEqual(ids(list.shown), ["all", "haw", "lmu", "lmu-ds", "passau-daad"]);
  assert.deepEqual(ids(list.otherUniversity), ["elsa", "family:2", "fau", "goethe-promos", "passau"], "FAU's grant and the other Deutschlandstipendien fold away");
  const page = html(createElement(CardList, { items, result, level: "bachelor", save: noSave, institution: "Ludwig-Maximilians-Universität München" }));
  const [main, folded] = page.split('<details class="mismatch-group">');
  const card = (id: string) => page.match(new RegExp(`<li class="card">(?:(?!</li>).)*href="/scholarships/call-${id}"(?:(?!</li>).)*</li>`))?.[0] || "";
  assert.match(card("lmu"), /Passt zu dir.*<span class="who-tag on">Deine Hochschule<\/span>/);
  assert.match(card("lmu-ds"), /Passt zu dir/);
  assert.doesNotMatch(card("fau"), /Passt zu dir/);
  assert.match(folded, /^<summary>Nur für Studierende anderer Hochschulen \(5\)<\/summary>.*call-fau/s);
  assert.doesNotMatch(main, /call-fau|call-elsa/);
  // A DAAD list naming a category or an English duplicate cannot be placed: it stays, without the badge, naming its universities.
  assert.doesNotMatch(card("haw"), /Passt zu dir/);
  assert.match(card("haw"), /<span class="who-tag fit ">Hochschule selbst prüfen<\/span><span class="who-tag quiet">Nur an: Duale Hochschule Baden-Württemberg, German universities of applied sciences \(HAW\) and Fachhochschulen<\/span>/);
  assert.match(card("all"), /Passt zu dir/);
  assert.equal(resultSummary(items, answers(result, { institution: "Ludwig-Maximilians-Universität München" })),
    "5 Stipendien nennen Bachelor ausdrücklich, sie stehen jetzt oben. Ganz unten eingeklappt: 5 nur für Studierende anderer Hochschulen.");
});

test("without an answer a call names its universities; one name that may be another's keeps it in the list", () => {
  const items = lmuCatalogue();
  const page = html(createElement(CardList, { items, result: null, level: null, save: noSave }));
  assert.match(page, /<span class="who-tag quiet">Nur an: Friedrich-Alexander-Universität Erlangen-Nürnberg<\/span>/);
  assert.match(page, /<span class="who-tag quiet">Nur an: Freie Universität Berlin, Humboldt-Universität zu Berlin, Technische Universität Berlin \+1<\/span>/);
  assert.match(page, /<span class="who-tag quiet">Alle Hochschulen<\/span>/);
  // "Goethe-Universität" is its Deutschlandstipendium's name and may also be
  // "Goethe-Universität Frankfurt am Main": that university's PROMOS call stays, unsure.
  const goethe = arrangeList(items, null, { institution: "Goethe-Universität" });
  assert.equal(goethe.scopes.get("goethe-ds")?.university, "own");
  const where = (id: string) => (["shown", "unstated", "otherUniversity"] as const).find(key => goethe[key].some(entry => entry.kind === "call" && entry.item.id === id));
  assert.equal(where("goethe-ds"), "shown");
  assert.equal(where("goethe-promos"), "shown");
  assert.equal(goethe.scopes.get("goethe-promos")?.university, "check");
  assert.equal(where("lmu"), "otherUniversity");
  // "Meine Hochschule ist nicht dabei": every specific university's call folds away, the unsure ones stay.
  const none = arrangeList(items, null, { institution: NOT_LISTED });
  assert.deepEqual(none.otherUniversity.map(entry => entry.kind === "family" ? "family" : entry.item.id).sort(), ["elsa", "family", "fau", "goethe-promos", "lmu", "passau"]);
  assert.equal(none.scopes.get("haw")?.university, "check");
});

test("a university's call compares on the German display name on both sides", () => {
  const hamburg = call("uhh", { provider: "University of Hamburg", institutions: ["Universität Hamburg"] });
  const known = universityChoices([hamburg]);
  assert.deepEqual(known, ["Universität Hamburg"]);
  assert.equal(universityFit({ ...hamburg, scope: "selected" }, "Universität Hamburg", known), "own");
  assert.equal(universityFit({ ...hamburg, scope: "selected" }, "University of Hamburg", known), "own", "a saved English answer still finds it");
  assert.equal(universityFit({ ...hamburg, scope: "all" }, "Universität Hamburg", known), null);
});

const tags = {
  cs: { code: "computer-science", name: "Informatik", group: "engineering" },
  biology: { code: "biology", name: "Biologie", group: "mathematics-natural-sciences" },
  engineering: { code: "engineering", name: "Ingenieurwissenschaften", group: null },
} satisfies Record<string, SubjectTag>;

test("with a subject, a call for other subjects folds away; a Fächergruppe answer leaves its single subjects open", () => {
  const groups = subjectGroups([[tags.cs, tags.biology, tags.engineering]]);
  assert.equal(subjectFit("selected", [tags.cs], "computer-science", groups), "own");
  assert.equal(subjectFit("selected", [tags.engineering], "computer-science", groups), "own", "the call names the answer's whole Fächergruppe");
  assert.equal(subjectFit("selected", [tags.biology], "computer-science", groups), "other");
  assert.equal(subjectFit("selected", [tags.cs], "engineering", groups), "check", "the student named only the Fächergruppe");
  assert.equal(subjectFit("selected", [tags.biology], "engineering", groups), "other");
  assert.equal(subjectFit("selected", [tags.biology], NOT_LISTED, groups), "other");
  assert.equal(subjectFit("selected", [tags.engineering], NOT_LISTED, groups), "check", "a whole Fächergruppe may hold the student's subject");
  assert.equal(subjectFit("selected", [], "computer-science", groups), "check");
  assert.equal(subjectFit("selected", [tags.biology], "law_rule_value", groups), "check", "an answer outside the taxonomy");
  assert.equal(subjectFit("all", [], "computer-science", groups), null);
  const items = [call("rise", { subjectScope: "selected", subjects: [tags.biology], levels: ["bachelor"] }), call("cs", { subjectScope: "selected", subjects: [tags.cs], levels: ["bachelor"] })];
  const page = html(createElement(CardList, { items, result: resultFor(items), level: "bachelor", save: noSave, subject: "computer-science" }));
  const [main, folded] = page.split('<details class="mismatch-group">');
  assert.match(main, /call-cs.*Passt zu dir|Passt zu dir.*call-cs/s);
  assert.match(main, /<span class="who-tag on">Nur für: Informatik<\/span>/);
  assert.match(folded, /^<summary>Nur für andere Fächer \(1\)<\/summary>.*call-rise/s);
  assert.doesNotMatch(folded, /Passt zu dir/);
});

const options = { state: "ready" as const, institution: ["Ludwig-Maximilians-Universität München", "Universität Bielefeld"], subject: ["biology", "computer-science", "engineering", "mathematics-natural-sciences"],
  subjectInfo: { biology: { label: "Biologie", group: "mathematics-natural-sciences" }, "computer-science": { label: "Informatik", group: "engineering" },
    engineering: { label: "Ingenieurwissenschaften", group: null }, "mathematics-natural-sciences": { label: "Mathematik, Naturwissenschaften", group: null } }, usesStudyPlan: false };

test("the chat asks for the subject from the taxonomy and offers nicht dabei for subject and university", () => {
  const none = { result: null, asked: [] as AnswersState["asked"], adult: null };
  const asked = questions(options, none);
  assert.deepEqual(asked.find(question => question.field === "subject")?.chips, [["biology", "Biologie"], ["computer-science", "Informatik"], ["engineering", "Ingenieurwissenschaften"],
    ["mathematics-natural-sciences", "Mathematik, Naturwissenschaften"], [NOT_LISTED, "Mein Fach ist nicht dabei"], ["", "Noch offen"]]);
  assert.deepEqual(asked.find(question => question.field === "institution")?.chips.slice(-2), [[NOT_LISTED, "Meine Hochschule ist nicht dabei"], ["", "Noch offen"]]);
  const select = renderToStaticMarkup(createElement("select", null, subjectOptions(options)));
  assert.equal(select, "<select><optgroup label=\"Ingenieurwissenschaften\"><option value=\"computer-science\">Informatik</option><option value=\"engineering\">Anderes Fach aus dieser Gruppe</option></optgroup>"
    + "<optgroup label=\"Mathematik, Naturwissenschaften\"><option value=\"biology\">Biologie</option><option value=\"mathematics-natural-sciences\">Anderes Fach aus dieser Gruppe</option></optgroup></select>");
  // The German name in typed text counts like a tap.
  assert.equal(interpretGoal("Ich studiere Informatik im Bachelor", options).facts.subject, "computer-science");
  // "Nicht dabei" stays in this tab: matching and a saved profile get an unknown answer.
  const request = matchRequest({ degree_level: "bachelor", institution: NOT_LISTED, subject: NOT_LISTED });
  assert.deepEqual([request.profile.facts.institution, request.profile.facts.subject], [{ value: null, value_state: "unknown", confirmation_state: "confirmed" }, { value: null, value_state: "unknown", confirmation_state: "confirmed" }]);
});

test("the short form offers every university with nicht dabei", () => {
  const list = { search: "", degree: "", subject: "", openOnly: false, soonOnly: false, byAmount: false, family: "", page: 0, subjects: [], today, state: "ready" as const, total: 1, scholarships: [call("1")] };
  const loaderData = { options, list, cvImport: false, studentAccounts: false, signedIn: false, savedIds: [], initialFacts: {}, adultConfirmed: false, savedContextUnavailable: false };
  const router = createMemoryRouter([{ id: "match", path: "/match", Component: Match }], { initialEntries: ["/match?mode=form"], hydrationData: { loaderData: { match: loaderData } } });
  const form = renderToStaticMarkup(createElement(RouterProvider, { router }));
  assert.match(form, /<select name="institution"><option value="" selected="">Weiß ich nicht<\/option><option value="__not_listed__">Meine Hochschule ist nicht dabei<\/option>.*<option value="Universität Bielefeld">Universität Bielefeld<\/option>/);
  assert.match(form, /<select name="subject">.*<option value="__not_listed__">Mein Fach ist nicht dabei<\/option>.*<optgroup label="Ingenieurwissenschaften"><option value="computer-science">Informatik<\/option>/);
});
