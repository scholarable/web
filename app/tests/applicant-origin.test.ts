import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import test from "node:test";
import Match from "../routes/match";
import { nextQuestion, questions, resultSummary } from "../components/discovery-chat";
import { arrangeList, CardList } from "../components/scholarship-list";
import { browseFilters, browseQuery } from "../lib/browse";
import { cardFacts } from "../lib/cards";
import { matchRequest, type AnswersState } from "../lib/discovery-answers";
import type { MatchResult, Recommendation } from "../lib/contracts";
import { MATCHING_CALLS_QUERY, profileOptions } from "../lib/matches.server";
import { originTags, type ScholarshipListItem } from "../lib/serving.server";
import { originFit, type OriginTag } from "../lib/study-fit";

// "Lebst du gerade im Ausland und willst zum Studium nach Deutschland kommen?"
// (owner decision 2026-10-28) against reviewed declarations of whom a call is
// for (public_call_origins): fold a call away only when sure.
const today = "2026-10-28";
const abroad: OriginTag = { track_id: null, origin: "from_abroad", groups: null };
const inGermany = (groups = "Deutsche, EU-Bürger:innen, nach § 8 BAföG Berechtigte"): OriginTag => ({ track_id: null, origin: "in_germany", groups });
function call(id: string, origins: OriginTag[]): ScholarshipListItem {
  const window = { id: "w", window_type: "application", deadline_on: "2026-12-01", deadline_precision: "date_only" };
  return { id, slug: `call-${id}`, title: `Ausschreibung ${id}`, provider: `Anbieter ${id}`, funding: "", deadline: "", audience: "", status: "open", lastChecked: null,
    applyNow: true, family: null, institutions: [], subjects: [], origins,
    card: cardFacts({ funding: [], tracks: [], windows: [window], applicationStatus: "open", effectiveState: null, deadlineOn: "2026-12-01",
      summaryMoney: { min: 30000, max: 30000, currency: "EUR", frequency: "monthly" }, levels: ["master"], levelRuleIds: ["level"], subjectScope: "all", institutionScope: "all" }, today) };
}
const recommendation = (callId: string): Recommendation => ({
  call_id: callId, track_id: null, route_id: null, status: "needs_confirmation", visible: true, actionable: false, window_state: "open", preference_matches: 0,
  title: "", slug: "", routeAvailable: true, openingOn: null, deadline: null, source: null,
  criteria: { matched: [{ id: "level", label: "Studium", kind: "required", status: "match", reason: "matched" }], mismatched: [], unknown: [] },
} as Recommendation);
const html = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(RouterProvider, { router: createMemoryRouter([{ path: "/", element }]) }));
const noSave = { studentAccounts: false, signedIn: false, savedIds: [] };
// DAAD incoming (from_abroad), a Begabtenförderungswerk (in_germany), a call
// with one track per group (Rosa-Luxemburg-Stiftung), one open to all, one undeclared.
const catalogue = () => [
  call("daad", [abroad]),
  call("werk", [inGermany()]),
  call("tracks", [{ track_id: "10", origin: "in_germany", groups: "Deutsche, nach § 8 BAföG Berechtigte" }, { track_id: "11", origin: "both", groups: null }]),
  call("all", [{ track_id: null, origin: "both", groups: null }]),
  call("plain", []),
];
const result = (items: ScholarshipListItem[]) => ({ recommendations: items.map(item => recommendation(item.id)) }) as MatchResult;
const card = (page: string, id: string) => page.match(new RegExp(`<li class="card">(?:(?!</li>).)*href="/scholarships/call-${id}"(?:(?!</li>).)*</li>`))?.[0] || "";

test("the answer is compared with the declarations: Nein folds only from-abroad calls, Ja only takes the badge from in-Germany calls", () => {
  assert.equal(originFit([abroad], "no"), "other");
  assert.equal(originFit([abroad], "yes"), "own");
  assert.equal(originFit([inGermany()], "yes"), "check");
  assert.equal(originFit([inGermany()], "no"), "own");
  assert.equal(originFit([abroad, { track_id: "2", origin: "both", groups: null }], "no"), "own", "a call fits when any track fits");
  assert.equal(originFit([inGermany(), { track_id: "2", origin: "both", groups: null }], "yes"), "own");
  assert.equal(originFit([], "no"), null, "an undeclared call is unaffected");
  assert.equal(originFit([abroad], ""), null, "Weiß ich nicht changes nothing");
  assert.equal(originFit([abroad], null), null);
});

test("Nein: a call only for applicants from abroad folds away under its own label; Ja: an in-Germany call stays without the badge and names its groups", () => {
  const items = catalogue();
  const no = arrangeList(items, result(items), { abroad: "no" });
  assert.deepEqual(no.otherOrigin.map(entry => entry.kind === "call" ? entry.item.id : ""), ["daad"]);
  assert.ok(!no.shown.some(entry => entry.kind === "call" && entry.item.id === "daad"));
  const nein = html(createElement(CardList, { items, result: result(items), level: "master", save: noSave, abroad: "no" }));
  const [main, folded] = nein.split('<details class="mismatch-group">');
  assert.match(folded, /^<summary>Nur für Bewerbungen aus dem Ausland \(1\)<\/summary>.*call-daad/s);
  assert.doesNotMatch(main, /call-daad/);
  assert.match(card(nein, "werk"), /Passt zu dir/);
  assert.match(card(nein, "werk"), /<span class="who-tag quiet">Nur für: Deutsche, EU-Bürger:innen, nach § 8 BAföG Berechtigte<\/span>/);

  const ja = html(createElement(CardList, { items, result: result(items), level: "master", save: noSave, abroad: "yes" }));
  assert.doesNotMatch(ja, /mismatch-group/, "nothing folds away on Ja");
  assert.doesNotMatch(card(ja, "werk"), /Passt zu dir/);
  assert.match(card(ja, "werk"), /<span class="who-tag fit ">Selbst prüfen<\/span><span class="who-tag quiet">Nur für: Deutsche, EU-Bürger:innen, nach § 8 BAföG Berechtigte<\/span>/);
  assert.match(card(ja, "daad"), /Passt zu dir.*<span class="who-tag on">Nur für Bewerbungen aus dem Ausland<\/span>/s);
  for (const id of ["tracks", "all", "plain"]) assert.match(card(ja, id), /Passt zu dir/, id);

  // Without an answer the cards say whom they are for and nothing folds away.
  const none = html(createElement(CardList, { items, result: null, level: null, save: noSave }));
  assert.match(card(none, "daad"), /<span class="who-tag quiet">Nur für Bewerbungen aus dem Ausland<\/span>/);
  assert.doesNotMatch(card(none, "tracks"), /Nur für:/, "groups only when every declared row agrees");
  assert.doesNotMatch(none, /mismatch-group/);

  const answers = { facts: { degree_level: "master", abroad: "no" }, adult: "yes", asked: [], chat: [], proposal: null, result: result(items), loading: false, error: null } as AnswersState;
  assert.equal(resultSummary(items, answers), "4 Stipendien nennen Master ausdrücklich, sie stehen in deiner Liste oben. Ganz unten eingeklappt: 1 nur für Bewerbungen aus dem Ausland.");
});

const options = { state: "ready" as const, institution: [], subject: [], usesStudyPlan: false };
test("the chat asks after level and age, only when a listed call is only for applicants from abroad, and the answer never leaves the tab", () => {
  const none = { result: null, asked: [] as AnswersState["asked"], adult: null };
  assert.deepEqual(questions(options, none).map(question => question.field), ["degree_level", "adult"]);
  const asked = questions({ ...options, askAbroad: true, subject: ["biology"] }, none);
  assert.deepEqual(asked.map(question => question.field), ["degree_level", "adult", "abroad", "subject"]);
  assert.deepEqual(asked[2], { field: "abroad", text: "Lebst du gerade im Ausland und willst zum Studium nach Deutschland kommen?",
    chips: [["yes", "Ja"], ["no", "Nein, ich bin schon in Deutschland"], ["", "Weiß ich nicht"]] });
  assert.equal(nextQuestion({ ...options, askAbroad: true }, { ...none, asked: ["degree_level", "adult"] })?.field, "abroad");
  // Not sent to matching, so it is never saved to a profile either.
  const request = matchRequest({ degree_level: "master", abroad: "yes" });
  assert.deepEqual(Object.keys(request.profile.facts).sort(), ["adult_confirmation", "degree_level", "institution", "milestone", "semester_number", "subject"]);
  assert.doesNotMatch(JSON.stringify(request), /abroad|yes/);
  // The catalogue decides whether to ask.
  const payload = { id: "x", requirements: [] };
  assert.equal(profileOptions([{ id: "x", title: "", slug: "", matching_payload: payload, origins: [{ track_id: null, origin: "from_abroad", groups: null }] }]).askAbroad, true);
  assert.equal(profileOptions([{ id: "x", title: "", slug: "", matching_payload: payload, origins: [{ track_id: null, origin: "in_germany", groups: "Deutsche" }] }]).askAbroad, false);
});

test("the short form asks the same question when the catalogue can use it", () => {
  const list = { search: "", degree: "", subject: "", openOnly: false, soonOnly: false, byAmount: false, family: "", page: 0, subjects: [], today, state: "ready" as const, total: 1, scholarships: [call("1", [])] };
  const render = (askAbroad: boolean) => {
    const loaderData = { options: { ...options, askAbroad }, list, cvImport: false, studentAccounts: false, signedIn: false, savedIds: [], initialFacts: {}, adultConfirmed: false, savedContextUnavailable: false };
    const router = createMemoryRouter([{ id: "match", path: "/match", Component: Match }], { initialEntries: ["/match?mode=form"], hydrationData: { loaderData: { match: loaderData } } });
    return renderToStaticMarkup(createElement(RouterProvider, { router }));
  };
  assert.match(render(true), /<label>Lebst du gerade im Ausland und willst zum Studium nach Deutschland kommen\?<select name="abroad"><option value="" selected="">Weiß ich nicht<\/option><option value="yes">Ja<\/option><option value="no">Nein, ich bin schon in Deutschland<\/option><\/select><\/label>/);
  assert.doesNotMatch(render(false), /name="abroad"/);
});

test("the list and matching read the declarations once, and malformed rows are dropped", () => {
  for (const text of [browseQuery(browseFilters(new URL("https://example.test/"))).text, MATCHING_CALLS_QUERY]) {
    assert.equal(text.match(/\bpublic_call_origins\b/g)?.length, 1);
    assert.match(text, /origins as materialized \(select call_id, track_id, origin, groups_de from public_call_origins\)/);
    assert.match(text, /coalesce\(od\.declared, '\[\]'::jsonb\) as origins/);
  }
  assert.deepEqual(originTags([{ track_id: null, origin: "from_abroad", groups: null }, { track_id: "12", origin: "in_germany", groups: " Deutsche " },
    { track_id: null, origin: "unclear", groups: null }, { track_id: "x", origin: "both" }, null, "both"]),
  [{ track_id: null, origin: "from_abroad", groups: null }, { track_id: "12", origin: "in_germany", groups: "Deutsche" }]);
});
