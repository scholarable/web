import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import test from "node:test";
import Match, { markCorrection } from "../routes/match";
import Home from "../routes/home";
import { nextQuestion, questions, resultSummary } from "../components/discovery-chat";
import { CardList, ListSummary, ListTools } from "../components/scholarship-list";
import { browseFilters } from "../lib/browse";
import { cardFacts } from "../lib/cards";
import { callFit, type AnswersState } from "../lib/discovery-answers";
import type { MatchResult, Recommendation } from "../lib/contracts";
import type { ScholarshipListItem } from "../lib/serving.server";

const today = "2026-10-20";
function item(id: string, levelRuleIds: string[], overrides: Partial<Parameters<typeof cardFacts>[0]> = {}, extra: Partial<ScholarshipListItem> = {}): ScholarshipListItem {
  return { id, slug: `call-${id}`, title: `Synthetic call ${id}`, provider: `Synthetic provider ${id}`, funding: "", deadline: "", audience: "", status: "open", lastChecked: null, applyNow: true, family: null, institutions: [], subjects: [], origins: [], ...extra,
    card: cardFacts({ funding: [
      { id: "stipend", track_id: null, condition_group_id: null, component_type: "living_stipend", amount_kind: "up_to", amount_min_minor: null, amount_max_minor: 85500,
        currency: "EUR", percentage: null, frequency: "monthly", duration_min_months: null, duration_max_months: null, starts_on: null, ends_on: null, is_conditional: true,
        description: "Depending on parental income." },
      { id: "flat", track_id: null, condition_group_id: null, component_type: "other", amount_kind: "exact", amount_min_minor: 30000, amount_max_minor: 30000,
        currency: "EUR", percentage: null, frequency: "monthly", duration_min_months: null, duration_max_months: null, starts_on: null, ends_on: null, is_conditional: false,
        description: "Study cost allowance for everyone." },
    ], tracks: [], windows: [{ id: "w", window_type: "application", deadline_on: "2026-10-26", deadline_precision: "date_only" }],
    applicationStatus: "open", effectiveState: null, deadlineOn: "2026-10-26", summaryMoney: {}, levels: levelRuleIds.length ? ["bachelor"] : [], levelRuleIds,
    subjectScope: "all", institutionScope: "unknown", ...overrides }, today) };
}
const html = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(RouterProvider, { router: createMemoryRouter([{ path: "/", element }]) }));
const noSave = { studentAccounts: false, signedIn: false, savedIds: [] };
// One call per status the list can show, on 2026-10-20.
const soon = { applicationStatus: "planned", deadlineOn: "2027-02-01", windows: [{ id: "w", window_type: "application", deadline_on: "2027-02-01", deadline_precision: "date_only", opens_on: "2026-11-15", opens_precision: "date_only" }] };
const statuses = () => [
  item("soon", [], soon, { applyNow: false }),
  item("perGroup", [], { effectiveState: "provider_defined" }, { applyNow: false }),
  item("open", [], { deadlineOn: "2027-01-15", windows: [{ id: "w", window_type: "application", deadline_on: "2027-01-15", deadline_precision: "date_only" }] }),
  item("urgent", []),
  item("overdue", [], {}, { applyNow: false, reviewOverdue: true, lastChecked: "2026-10-17T09:26:00Z" }),
  item("provider", [], { applicationStatus: "planned", deadlineOn: null, windows: [] }, { applyNow: false }),
  item("closed", [], { effectiveState: "closed" }, { applyNow: false }),
];
const listState = { search: "", degree: "", subject: "", openOnly: false, soonOnly: false, byAmount: false, page: 0, subjects: [], today, state: "ready" as const, total: 1, scholarships: [item("1", ["degree"])] };
function render(path = "/match", options = { state: "ready" as const, institution: ["Synthetic University"], subject: ["synthetic_subject"], usesStudyPlan: false }, list = listState) {
  const loaderData = { options, list, cvImport: false, studentAccounts: false, signedIn: false, savedIds: [], initialFacts: {}, adultConfirmed: false, savedContextUnavailable: false };
  const router = createMemoryRouter([{ id: "match", path: "/match", Component: Match }], { initialEntries: [path], hydrationData: { loaderData: { match: loaderData } } });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}
const recommendation = (callId: string, status: Recommendation["status"], matched: string[], mismatched: string[] = [], unknown = 2): Recommendation => ({
  call_id: callId, track_id: null, route_id: null, status, visible: true, actionable: false, window_state: "open", preference_matches: 0,
  title: "", slug: "", routeAvailable: true, openingOn: null, deadline: null, source: null,
  criteria: {
    matched: matched.map(id => ({ id, label: "Studium", kind: "required", status: "match", reason: "matched" })),
    mismatched: mismatched.map(id => ({ id, label: "Promotion ausgeschlossen", kind: "exclusion", status: "mismatch", reason: "mismatch" })),
    unknown: Array.from({ length: unknown }, (_, i) => ({ id: `u${i}`, label: "Selbst prüfen", kind: "required", status: "needs_confirmation", reason: "unknown_fact" })),
  },
} as Recommendation);

test("the start page counts every listed scholarship and links to the list instead of showing it", () => {
  // The loader still sends every listed call: the chat counts them.
  const many = Array.from({ length: 130 }, (_, index) => item(String(index + 1), ["degree"], {}, { applyNow: index === 0 }));
  const html = render(undefined, undefined, { ...listState, total: 130, scholarships: many });
  assert.match(html, /130 geprüfte Stipendien für dein Studium/);
  assert.match(html, /<a class="jump" href="\/scholarships"[^>]*>Alle 130 ansehen <svg/);
  assert.doesNotMatch(html, /<li class="card">|id="list"|Synthetic call|Weitere Stipendien/);
});

test("first screen is one chat box with tap answers on the blue block, no list, note, form fields or uploads", () => {
  const html = render();
  assert.match(html, /<h1 id="hero-h">Finde dein <em>Stipendium\.<\/em><\/h1>/);
  const composer = html.match(/<form class="composer big"[^>]*>/)?.[0] || "";
  assert.match(composer, /method="post"/);
  assert.match(composer, /action="\/match"/);
  assert.match(html, /<input id="scholarship-goal"[^>]*placeholder="Was studierst du\?"/);
  assert.doesNotMatch(html, /<input id="scholarship-goal"[^>]*name=/, "typed text never posts before the page is ready");
  assert.match(html, /<button class="send" aria-label="Senden" disabled=""/);
  for (const chip of ["Bachelor", "Master", "Promotion", "Weiß ich noch nicht"]) assert.match(html, new RegExp(`class="chip"[^>]*>${chip}</button>`));
  assert.doesNotMatch(html, /Bitte keine Namen oder Kontaktdaten|aria-describedby/);
  assert.match(html, /<noscript>/);
  assert.doesNotMatch(html, /id="list"|Synthetic call 1/);
  for (const field of ["adult", "institution", "degree_level", "subject", "semester_number", "future_plan"]) assert.doesNotMatch(html, new RegExp(`name="${field}"`));
  assert.doesNotMatch(html, /type="file"|name="(?:citizenship|grade|email|cv)"/);
});

test("short-form entry asks the age explicitly, never pre-checked, and posts nothing before hydration", () => {
  const html = render("/match?mode=form");
  assert.match(html, /Bist du 18 oder älter\?/);
  assert.match(html, /name="adult" value="yes"/);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /action="\/api\/matches"/);
  assert.match(html, /disabled=""[^>]*>Liste sortieren/);
  assert.doesNotMatch(html, /id="scholarship-goal"/);
  assert.match(html, /Lieber chatten/);
  assert.match(render("/match?mode=unknown"), /Finde dein/);
});

test("home is the same front door without putting answers in a URL", () => {
  const loaderData = { options: { state: "ready", institution: [], subject: [], usesStudyPlan: false }, list: listState, cvImport: false, studentAccounts: false, signedIn: false, savedIds: [], initialFacts: {}, adultConfirmed: false, savedContextUnavailable: false };
  const router = createMemoryRouter([{ id: "home", path: "/", Component: Home }], { hydrationData: { loaderData: { home: loaderData } } });
  const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
  assert.match(html, /Finde dein/);
  assert.match(html, /method="post"/);
  assert.doesNotMatch(html, /name="goal"|action="[^"]*\?/);
});

test("the chat asks only questions the catalogue can use", () => {
  const empty = { state: "ready" as const, institution: [], subject: [], usesStudyPlan: false };
  const none = { result: null, asked: [] as AnswersState["asked"], adult: null };
  assert.deepEqual(questions(empty, none).map(question => question.field), ["degree_level", "adult"]);
  assert.deepEqual(questions({ ...empty, subject: ["law"], institution: ["Uni"], usesStudyPlan: true }, none).map(question => question.field), ["degree_level", "adult", "subject", "institution", "future_plan"]);
  const followUp = { recommendations: [], followUps: [{ field: "semester_number", label: "" }] } as MatchResult;
  assert.ok(questions(empty, { ...none, result: followUp }).some(question => question.field === "semester_number"));
  assert.equal(nextQuestion(empty, { ...none, asked: ["degree_level"] })?.field, "adult");
  assert.equal(nextQuestion(empty, { ...none, asked: ["degree_level", "adult"] }), null);
  assert.equal(nextQuestion(empty, { ...none, adult: "no" }), null, "under-18 answers stop the questions");
});

test("a match result sorts and labels: named level first, not stated after, conflicts folded", () => {
  const items = [item("named", ["degree"]), item("silent", []), item("conflict", ["degree"])];
  const result = { recommendations: [recommendation("named", "needs_confirmation", ["degree"]), recommendation("silent", "needs_confirmation", []), recommendation("conflict", "mismatch", [], ["degree"])] } as MatchResult;
  assert.equal(callFit(result, "named", ["degree"])?.level, "ok");
  assert.equal(callFit(result, "silent", [])?.level, "none");
  assert.equal(callFit(result, "conflict", ["degree"])?.conflict, true);
  const answers = { facts: { degree_level: "bachelor" }, adult: "yes", asked: [], chat: [], proposal: null, result, loading: false, error: null } as AnswersState;
  assert.equal(resultSummary(items, answers), "1 Stipendium nennt Bachelor ausdrücklich, es steht in deiner Liste oben. Bei 1 steht kein Studienniveau, es kommt danach. Ganz unten eingeklappt: 1 passt laut Regeln nicht.");
  const page = html(createElement(CardList, { items, result, level: "bachelor", save: noSave }));
  // The chat's labels work inside the groups: named first, grouped by status; no level stated after; conflicts folded.
  assert.match(page, /<h2 class="group-h" id="group-open">Jetzt offen <span class="count">1<\/span><\/h2>/);
  assert.match(page, /<h2 class="group-h" id="group-unstated">Studienniveau nicht angegeben <span class="count">1<\/span><span class="hint"> Seite prüfen<\/span><\/h2>/);
  assert.ok(page.indexOf("Synthetic call named") < page.indexOf("group-unstated") && page.indexOf("group-unstated") < page.indexOf("Synthetic call silent"));
  assert.match(page, /Passt zu dir/);
  assert.match(page, /<span class="who-tag fit ok">Bachelor passt<\/span><span class="who-tag quiet">2 Punkte selbst prüfen<\/span>/);
  assert.match(page, /<span class="who-tag fit ">Nicht angegeben<\/span><span class="who-tag quiet">Studienniveau, Seite prüfen<\/span>/);
  assert.match(page, /<details class="mismatch-group"><summary>Passt laut Regeln nicht zu deinen Angaben \(1\)/);
  assert.match(page, /Passt laut Regeln nicht<\/span>/);
  assert.match(page, /laut Regel: Promotion ausgeschlossen/);
});

test("cards lead with the provider, money and the deadline, in German, from the stored components", () => {
  const page = html(createElement(CardList, { items: [item("1", ["degree"])], result: null, level: null, save: noSave }));
  assert.match(page, /<h3><a href="\/scholarships\/call-1"[^>]*>Synthetic provider 1<\/a><\/h3><p class="call-title">Synthetic call 1<\/p>/);
  assert.match(page, /<span class="pre">bis zu <\/span><span class="num">855\s€<small> \/ Monat<\/small><\/span><span class="money-more">je nach Einkommen · \+ 300\s€ im Monat für alle<\/span>/);
  assert.match(page, /<p class="card-status"><span class="pill urgent">noch 6 Tage<\/span><span class="when">bis 26\. Okt\.<\/span><\/p>/);
  assert.match(page, /<p class="who"><span class="who-tag">Bachelor<\/span><span class="who-tag quiet">Alle Fächer<\/span><\/p>/);
  // Without a provider name the call title is the heading.
  assert.match(html(createElement(CardList, { items: [item("2", [], {}, { provider: null })], result: null, level: null, save: noSave })), /<h3><a href="\/scholarships\/call-2"[^>]*>Synthetic call 2<\/a><\/h3>(?!<p class="call-title">)/);
});

test("the list groups calls by status with a count each, and Jetzt offen is exactly apply_now_calls", () => {
  const page = html(createElement(CardList, { items: statuses(), result: null, level: null, save: noSave }));
  const heads = [...page.matchAll(/<h2 class="group-h" id="group-(\w+)">([^<]+) <span class="count">(\d+)<\/span>(?:<span class="hint"> ([^<]+)<\/span>)?/g)].map(match => match.slice(1).join("|"));
  assert.deepEqual(heads, ["open|Jetzt offen|2|", "check|Offen laut letzter Prüfung|1|bitte beim Anbieter bestätigen", "soon|Öffnet bald|1|Frist steht schon fest",
    "varies|Termin je nach Gruppe|2|oder beim Anbieter", "closed|Bewerbung geschlossen|1|nächste Runde beim Anbieter"]);
  const order = ["urgent", "open", "overdue", "soon", "perGroup", "provider", "closed"].map(id => page.indexOf(`Synthetic call ${id}<`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "by deadline inside each group");
  assert.match(page, /<span class="pill open">offen<\/span><span class="when">bis 15\. Jan\. 2027<\/span><span class="sub">noch 87 Tage<\/span>/);
  assert.match(page, /<span class="pill later">öffnet 15\. Nov\.<\/span><span class="sub">Frist 1\. Feb\. 2027<\/span>/);
  assert.match(page, /<span class="pill varies">Frist je nach Gruppe<\/span>/);
  assert.match(page, /<span class="pill varies">Termin beim Anbieter<\/span>/);
  assert.match(page, /<span class="pill closed">geschlossen<\/span><span class="sub">Frist war 26\. Okt\.<\/span>/);
  assert.match(page, /Zuletzt geprüft am 17\. Oktober 2026\. Bitte auf der Seite des Anbieters prüfen\./);
  // "Öffnet bald" shows only that group; the start page's groups sit under its h2 list heading.
  const later = html(createElement(CardList, { items: statuses(), result: null, level: null, soonOnly: true, heading: "h3", save: noSave }));
  assert.match(later, /<h3 class="group-h" id="group-soon">Öffnet bald/);
  assert.match(later, /<h4><a href="\/scholarships\/call-soon"/);
  assert.doesNotMatch(later, /group-open|group-varies|Synthetic call urgent/);
  assert.match(html(createElement(CardList, { items: [item("urgent", [])], result: null, level: null, soonOnly: true, save: noSave })), /Gerade öffnet keins dieser Stipendien bald/);
});

test("nach Betrag puts the most money per month first inside each group, then one-off and unpriced money", () => {
  const money = (id: string, min: number | null, frequency = "monthly") => item(id, [], { funding: [], summaryMoney: min === null ? {} : { min, max: min, currency: "EUR", frequency } });
  const items = [money("low", 30000), money("once", 200000, "one_time"), money("none", null), money("high", 107200), money("yearly", 600000, "yearly")];
  const page = html(createElement(CardList, { items, result: null, level: null, byAmount: true, save: noSave }));
  const order = ["high", "yearly", "low", "once", "none"].map(id => page.indexOf(`Synthetic call ${id}<`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(page, /<span class="num">2\.000\s€<small> einmalig<\/small><\/span>/);
  assert.match(page, /<span class="num text">Betrag auf der Seite des Anbieters<\/span>/);
});

test("the level filter keeps calls that state no level, after the ones that name it", () => {
  const items = [item("silent", [], { levels: [] }), item("named", ["degree"], { levels: ["master", "bachelor", "staatsexamen", "diplom", "magister"] })];
  const page = html(createElement(CardList, { items, result: null, level: null, filterLevel: "bachelor", save: noSave }));
  assert.ok(page.indexOf("Synthetic call named") < page.indexOf("Studienniveau nicht angegeben") && page.indexOf("Studienniveau nicht angegeben") < page.indexOf("Synthetic call silent"));
  // Levels as tags in the usual order, the chosen one marked, the rest counted.
  assert.match(page, /<span class="who-tag on">Bachelor<\/span><span class="who-tag">Master<\/span><span class="who-tag">Staatsexamen<\/span><span class="who-tag">\+2<\/span>/);
});

test("the summary line counts the whole list, open now and the next deadline among those", () => {
  const items = statuses();
  assert.equal(html(createElement(ListSummary, { items, total: 7 })),
    '<p class="summary"><b>7 geprüfte Stipendien</b> · 2 jetzt offen · nächste Frist <span class="hot">26. Okt., noch 6 Tage</span></p>');
  assert.equal(html(createElement(ListSummary, { items, total: 7, soonOnly: true })), '<p class="summary"><b>1 geprüftes Stipendium</b></p>');
  // The overdue call closes sooner, but it is not confirmed open, so it is not "the next deadline".
  const overdueFirst = [item("overdue", [], { deadlineOn: "2026-10-21", windows: [{ id: "w", window_type: "application", deadline_on: "2026-10-21", deadline_precision: "date_only" }] }, { applyNow: false }),
    item("open", [], { deadlineOn: "2027-01-15", windows: [{ id: "w", window_type: "application", deadline_on: "2027-01-15", deadline_precision: "date_only" }] })];
  assert.match(html(createElement(ListSummary, { items: overdueFirst, total: 2 })), /nächste Frist <span>15\. Jan\. 2027, noch 87 Tage<\/span>/);
});

test("filters are links that keep the other choices and mark the current one", () => {
  const tools = html(createElement(ListTools, { path: "/scholarships", filters: browseFilters(new URL("https://example.test/?degree=master&q=stiftung")) }));
  assert.match(tools, /<a class="filter-chip" aria-current="true" href="\/scholarships\?q=stiftung&amp;degree=master"[^>]*>Alle<\/a>/);
  assert.match(tools, /href="\/scholarships\?q=stiftung&amp;degree=master&amp;status=open"[^>]*>Jetzt offen<\/a>/);
  assert.match(tools, /href="\/scholarships\?q=stiftung&amp;degree=master&amp;status=soon"[^>]*>Öffnet bald<\/a>/);
  assert.match(tools, /href="\/scholarships\?q=stiftung&amp;degree=bachelor"[^>]*>Bachelor<\/a>/);
  assert.match(tools, /aria-current="true" href="\/scholarships\?q=stiftung"[^>]*>Master<\/a>/, "tapping the chosen level clears it");
  assert.match(tools, /aria-current="true" href="\/scholarships\?q=stiftung&amp;degree=master"[^>]*>nach Frist<\/a>/);
  assert.match(tools, /href="\/scholarships\?q=stiftung&amp;degree=master&amp;sort=amount"[^>]*>nach Betrag<\/a>/);
});

test("correction measurement ignores new answers and counts each corrected field once", () => {
  const seen = new Set<string>();
  assert.equal(markCorrection(seen, "subject", "", "computer_science"), false);
  assert.equal(markCorrection(seen, "subject", "computer_science", "law"), true);
  assert.equal(markCorrection(seen, "subject", "law", "biology"), false);
  assert.equal(markCorrection(seen, "degree_level", "bachelor", "bachelor"), false);
  assert.equal(markCorrection(seen, "degree_level", "bachelor", "master"), true);
});
