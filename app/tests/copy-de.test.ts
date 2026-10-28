import assert from "node:assert/strict";
import test from "node:test";
import { browseFilters, browseQuery, mentionedRuleIds, mentionedValues } from "../lib/browse";
import { dateLong, dateShort, deadlineWords, incomeDependent, moneyFromSummary, moneyLine, moneyText, monthLong, openingWords, sourceLabel, timing } from "../lib/copy-de";
import { interpretAge, interpretGoal } from "../lib/discovery";
import { demoBrowse, demoCalls } from "../lib/demo-catalogue.server";
import type { FundingComponent } from "../lib/public-details";
import type { ActivityWindow } from "../lib/activity-planning";

const component = (extra: Partial<FundingComponent>): FundingComponent => ({ id: "c", track_id: null, condition_group_id: null, component_type: "living_stipend",
  amount_kind: "exact", amount_min_minor: null, amount_max_minor: null, currency: "EUR", percentage: null, frequency: "monthly", duration_min_months: null,
  duration_max_months: null, starts_on: null, ends_on: null, is_conditional: false, description: "Stated by the provider.", ...extra });
const flat = component({ id: "flat", component_type: "other", amount_min_minor: 30000, amount_max_minor: 30000, description: "Study cost allowance." });
const window = (extra: Partial<ActivityWindow>): ActivityWindow => ({ id: "w", track_id: null, route_id: null, window_type: "application", audience: null, provider_text: "",
  opens_on: null, opens_precision: "unknown", deadline_on: "2026-10-31", deadline_precision: "date_only", deadline_time: null, deadline_timezone: null, ...extra });
const nbsp = (text: string) => text.replaceAll(" ", " ");

test("the leading stipend is the one paying most per month, monthly first; one-off money after recurring, unpriced last", () => {
  // Emden/Leer (call 68) stores 300 € a month and the same money as 3,600 € a year.
  const monthly = component({ id: "m", amount_min_minor: 30000, amount_max_minor: 30000 });
  const yearly = component({ id: "y", amount_min_minor: 360000, amount_max_minor: 360000, frequency: "yearly" });
  assert.equal(nbsp(moneyText(moneyLine([yearly, monthly], [])!)), "300 € im Monat");
  assert.equal(nbsp(moneyText(moneyLine([monthly, yearly], [])!)), "300 € im Monat", "the order of the stored components does not matter");
  // A semester amount worth more per month wins over a smaller monthly one.
  const semester = component({ id: "s", amount_min_minor: 180000, amount_max_minor: 180000, frequency: "semester" });
  const smaller = component({ id: "sm", amount_min_minor: 25000, amount_max_minor: 25000 });
  const perSemester = moneyLine([smaller, semester], [])!;
  assert.equal(nbsp(moneyText(perSemester)), "1.800 € pro Semester");
  assert.equal(perSemester.perMonth, 30000);
  // Recurring money leads a one-off amount, however large; unpriced money comes last.
  const oneOff = component({ id: "o", amount_min_minor: 500000, amount_max_minor: 500000, frequency: "one_time" });
  assert.equal(nbsp(moneyText(moneyLine([oneOff, smaller], [])!)), "250 € im Monat");
  assert.equal(nbsp(moneyText(moneyLine([oneOff, component({ id: "u", amount_kind: "provider_defined", frequency: "other" })], [])!)), "5.000 € einmalig");
});

test("money line names the stipend, says income only when stored, and adds the flat amount for everyone", () => {
  const income = component({ amount_kind: "up_to", amount_max_minor: 85500, is_conditional: true, description: "Depends on parental income." });
  const line = moneyLine([income, flat], [])!;
  assert.deepEqual({ ...line, plus: nbsp(line.plus), head: { ...line.head, num: nbsp((line.head as { num: string }).num) } },
    { head: { pre: "bis zu", num: "855 €", unit: "im Monat" }, note: "je nach Einkommen", plus: "+ 300 € im Monat für alle", small: "", amount: 85500, perMonth: 85500 });
  const bafog = moneyLine([component({ amount_kind: "up_to", amount_max_minor: 85500, description: "Nach den Richtlinien des BAföG." }), flat], [])!;
  assert.equal(bafog.note, "", "BAföG rules alone are not called income-based");
  const unpriced = moneyLine([component({ amount_kind: "provider_defined", frequency: "other", description: "In line with BAföG, depending on parental income." }), flat], [])!;
  assert.equal(nbsp(moneyText(unpriced)), "300 € im Monat");
  assert.equal(unpriced.note, "für alle");
  assert.equal(unpriced.plus, "+ Grundstipendium je nach Einkommen, Höhe beim Anbieter");
  const tracks = [{ id: "home", label: "Inland (Deutsche)" }, { id: "intl", label: "International" }];
  const tracked = moneyLine([component({ track_id: "home", amount_kind: "provider_defined", description: "Einkommensabhängig." }),
    component({ id: "if", track_id: "home", component_type: "other", amount_min_minor: 30000, amount_max_minor: 30000, is_conditional: true }),
    component({ id: "intl", track_id: "intl", amount_min_minor: 99200, amount_max_minor: 99200 })], tracks)!;
  assert.equal(moneyText(tracked), "Grundstipendium je nach Einkommen");
  assert.equal(nbsp(tracked.plus), "+ 300 € im Monat, wenn zutreffend");
  assert.equal(tracked.small, "Inland · Höhe beim Anbieter · andere Beträge für International");
  assert.equal(moneyLine([], []), null);
  assert.equal(moneyText(moneyFromSummary({})), "Betrag auf der Seite des Anbieters");
  assert.equal(nbsp(moneyText(moneyFromSummary({ min: 30000, max: 30000, currency: "EUR", frequency: "monthly" }))), "300 € im Monat");
  // "Nach Betrag" compares the headline per month; one-off and unpriced money has no monthly figure.
  assert.deepEqual([unpriced.amount, unpriced.perMonth], [30000, 30000], "the flat amount heads when the stipend has no price");
  assert.deepEqual([tracked.amount, tracked.perMonth], [null, null]);
  const yearly = moneyLine([component({ amount_min_minor: 120000, amount_max_minor: 120000, frequency: "yearly" })], [])!;
  assert.deepEqual([yearly.amount, yearly.perMonth], [120000, 10000]);
  const once = moneyLine([component({ component_type: "one_time_grant", amount_min_minor: 200000, amount_max_minor: 200000, frequency: "one_time" })], [])!;
  assert.deepEqual([once.amount, once.perMonth], [200000, null]);
  const range = moneyFromSummary({ min: 50200, max: 90000, currency: "EUR", frequency: "monthly" });
  assert.deepEqual([range.amount, range.perMonth], [90000, 90000]);
});

test("timing says open, urgent, opening later or per group, from the stored window", () => {
  const today = "2026-10-20";
  const open = timing({ applicationStatus: "open", effectiveState: null, deadlineOn: "2026-10-26", windows: [window({ deadline_on: "2026-10-26" })] }, today);
  assert.deepEqual([open.pill, open.label, open.cell.value, open.cell.sub, open.left], ["urgent", "Bewerbung offen", "26. Okt.", "noch 6 Tage", 6]);
  const later = timing({ applicationStatus: "planned", effectiveState: null, deadlineOn: "2027-02-01", windows: [window({ deadline_on: "2027-02-01", opens_on: "2026-11-15", opens_precision: "date_only" })] }, today);
  assert.deepEqual([later.label, later.cell.label, later.cell.value, later.cell.sub], ["Öffnet 15. Nov.", "Öffnet", "15. Nov.", "Frist 1. Feb. 2027"]);
  const unknownOpening = timing({ applicationStatus: "planned", effectiveState: null, deadlineOn: "2027-04-01", windows: [window({ deadline_on: "2027-04-01" })] }, today);
  assert.deepEqual([unknownOpening.label, unknownOpening.cell.value], ["Öffnet später", "später"]);
  // An estimated date is a month the provider names: never a day, and no day count.
  const estimated = timing({ applicationStatus: "open", effectiveState: null, deadlineOn: "2027-02-28", windows: [window({ deadline_on: "2027-02-28", deadline_precision: "estimated" })] }, today);
  assert.deepEqual([estimated.pill, estimated.cell.value, estimated.cell.sub, estimated.left, estimated.deadlineEstimated],
    ["open", "Feb. 2027", "Tag nicht angegeben", null, true]);
  const closingSoon = timing({ applicationStatus: "open", effectiveState: null, deadlineOn: "2026-10-31", windows: [window({ deadline_on: "2026-10-31", deadline_precision: "estimated" })] }, today);
  assert.deepEqual([closingSoon.pill, closingSoon.cell.value, closingSoon.left], ["open", "Okt.", null]);
  const estimatedOpening = timing({ applicationStatus: "planned", effectiveState: null, deadlineOn: "2027-02-28",
    windows: [window({ opens_on: "2027-01-01", opens_precision: "estimated", deadline_on: "2027-02-28", deadline_precision: "estimated" })] }, today);
  assert.deepEqual([estimatedOpening.label, estimatedOpening.cell.label, estimatedOpening.cell.value, estimatedOpening.cell.sub, estimatedOpening.opensEstimated],
    ["Öffnet im Jan. 2027", "Öffnet", "im Jan. 2027", "Frist im Feb. 2027", true]);
  assert.equal(later.opensEstimated, false);
  assert.equal(timing({ applicationStatus: "open", effectiveState: "provider_defined", deadlineOn: null, windows: [] }, today).cell.value, "je nach Gruppe");
  assert.equal(timing({ applicationStatus: "rolling", effectiveState: null, deadlineOn: "2026-10-31", windows: [] }, today).cell.label, "Laufend bis");
  assert.equal(dateShort("2027-01-15", today), "15. Jan. 2027");
  assert.equal(dateLong("2026-10-25"), "25. Oktober 2026");
});

test("deadline words keep what the provider did not confirm visible", () => {
  assert.deepEqual(deadlineWords(window({})), { text: "31. Oktober 2026", quiet: "Uhrzeit nicht angegeben" });
  assert.deepEqual(deadlineWords(window({ deadline_precision: "exact_local_time", deadline_time: "16:00:00" })), { text: "31. Oktober 2026, 16:00 Uhr", quiet: "Zeitzone nicht angegeben" });
  assert.deepEqual(deadlineWords(window({ deadline_precision: "rolling" })), { text: "laufend bis 31. Oktober 2026", quiet: "" });
  assert.deepEqual(deadlineWords(window({ deadline_on: "2027-02-28", deadline_precision: "estimated" })),
    { text: "voraussichtlich im Februar 2027", quiet: "Genauer Tag nicht angegeben, bitte beim Anbieter prüfen" });
  // SDV: "startet voraussichtlich im Januar nächsten Jahres", stored as 1 January.
  assert.equal(openingWords(window({ opens_on: "2027-01-01", opens_precision: "estimated", deadline_on: null, deadline_precision: "not_announced" })),
    "Öffnet voraussichtlich im Januar 2027, bitte beim Anbieter prüfen.");
  assert.equal(openingWords(window({ opens_on: "2027-01-15", opens_precision: "date_only" })), "Öffnet am 15. Januar 2027.");
  assert.equal(monthLong("2027-01-01"), "Januar 2027");
  assert.equal(deadlineWords(undefined).text, "Frist auf der Seite des Anbieters");
});

test("the chat reads German study words and the age answer, never keeping the age", () => {
  const options = { institution: [], subject: [], usesStudyPlan: false };
  assert.deepEqual(interpretGoal("Ich mache einen Master, 3. Semester", options).facts, { degree_level: "master", semester_number: "3" });
  assert.equal(interpretGoal("Ich promoviere in Chemie", options).facts.degree_level, "doctoral");
  assert.equal(interpretGoal("Bachelor oder Master?", options).conflictField, "degree_level");
  assert.equal(interpretAge("ich bin 19 und studiere"), "yes");
  assert.equal(interpretAge("17 Jahre alt"), "no");
  assert.equal(interpretAge("ich bin 3. Semester"), null, "a semester is not an age");
  assert.equal(interpretAge("Master Informatik"), null);
});

test("study level sorts and labels: no stated level stays listed, named first, exclusions drop out", () => {
  const silent = { ...demoCalls[0], id: "silent", title: "Sample: no level stated", matching_payload: { ...demoCalls[0].matching_payload, requirements: [] } };
  const excludes = { ...demoCalls[0], id: "excludes", matching_payload: { ...demoCalls[0].matching_payload, requirements: [
    { id: "x", label: "Doctoral candidates are excluded", criterion_key: "degree_level", kind: "exclusion", operator: "in", value: { expected: ["doctoral"] } }] } };
  const calls = [silent, ...demoCalls, excludes];
  assert.deepEqual(demoBrowse(browseFilters(new URL("https://example.test/?degree=bachelor")), calls).scholarships.map(row => row.id),
    ["demo-bachelor", "demo-exchange", "silent", "excludes"]);
  assert.deepEqual(demoBrowse(browseFilters(new URL("https://example.test/?degree=doctoral")), calls).scholarships.map(row => row.id), ["demo-doctoral", "silent"]);
  assert.deepEqual(mentionedValues(excludes.matching_payload, "degree_level", ["exclusion"]), ["doctoral"]);
  assert.deepEqual(mentionedRuleIds(demoCalls[0].matching_payload, "degree_level"), ["degree"]);
  assert.deepEqual(mentionedRuleIds(excludes.matching_payload, "degree_level"), [], "an exclusion never counts as a stated level");
  const statement = browseQuery(browseFilters(new URL("https://example.test/?degree=bachelor")));
  assert.equal(statement.values.length, 5);
  assert.match(statement.text, /level_rule_ids/);
  assert.match(statement.text, /rule->>'kind' in \('exclusion'\)/);
  assert.doesNotMatch(statement.text, /bachelor/, "the level stays a parameter");
});

test("source links read as their address, never as a stored internal title", () => {
  assert.equal(sourceLabel("https://www.uni-nord.example/deutschlandstipendium/bewerber/bewerbungsschritte-und-faq.html"), "uni-nord.example/…/bewerbungsschritte-und-faq");
  assert.equal(sourceLabel("https://www.foundation-a.example/pdf/stuf_dok_bew_stip.pdf"), "foundation-a.example/…/stuf_dok_bew_stip.pdf");
  assert.equal(sourceLabel("https://foundation-b.example/studierendenfoerderung/"), "foundation-b.example/studierendenfoerderung");
  assert.equal(sourceLabel("https://www.exchange.example/"), "exchange.example");
  assert.equal(sourceLabel("https://www.foundation-c.example/de/stipendien-f%C3%BCr-deutsche"), "foundation-c.example/…/stipendien-für-deutsche");
});

test("only wording that says the stipend depends on income adds \"je nach Einkommen\"", () => {
  // Phrasings from the published stipend descriptions (2026-10-23).
  for (const text of [
    "Monthly stipend based on BAföG calculation, depending on parents' income",
    "additional monthly support of up to 855 euros depending on the income and assets of the students",
    "calculated depending on parental income analogous to BAföG, maximum 855 EUR per month",
    "EU nationals among the international students receive the income-dependent BMFTR stipend instead",
    "Wie beim BAföG werden Einkommen und Vermögen der Stipendiatin oder des Stipendiaten angerechnet",
    "Einkommensabhängiges Stipendium für inländische Studierende",
    "Grundstipendium angelehnt an BAföG, einkommensabhängig, bis zu 855 € monatlich",
    "Der monatliche Förderungsbetrag ist abhängig vom Einkommen der Eltern",
    "Die Höhe richtet sich nach dem Einkommen der Eltern",
  ]) assert.equal(incomeDependent(text), true, text);
  for (const text of [
    "Das Stipendium wird nicht als Einkommen bei Sozialleistungen angerechnet und ist nicht als Arbeitsentgelt zu versteuern",
    "Zusätzlich kann eine einkommensunabhängige Studienkostenpauschale von 300 € monatlich gezahlt werden",
    "die alle Stipendiat*innen unabhängig vom Stipendium und vom Einkommen der Eltern erhalten",
    "Studienkostenpauschale von 300 € im Monat, unabhängig vom Einkommen der Eltern",
    "for all BMFTR-funded students, independent of parental income",
    "Gefördert wird unabhängig von Einkommen und Vermögen",
    "Grundstipendium nach den Richtlinien des BAföG: bis zu 855 Euro BAföG-Höchstsatz pro Monat",
  ]) assert.equal(incomeDependent(text), false, text);
  // A negation just before the phrase turns it around (Konstanz, call 33: "Not dependent on income").
  for (const text of [
    "300 EUR per month. Not dependent on income.",
    "The stipend is not dependent on the parents' income",
    "It does not depend on income and is not a loan",
    "no income-dependent deduction applies",
    "Der Betrag ist nicht abhängig vom Einkommen der Eltern",
    "Es handelt sich um kein einkommensabhängiges Stipendium",
    "Die Förderung ist nicht je nach Einkommen gestaffelt",
    "paid regardless of income and assets",
  ]) assert.equal(incomeDependent(text), false, text);
  // A negation in another clause, or further back, does not.
  for (const text of [
    "Das Stipendium muss nicht zurückgezahlt werden, die Höhe richtet sich nach dem Einkommen der Eltern",
    "Kein Darlehen: Höhe je nach Einkommen der Eltern",
    "Not a loan. Monthly stipend depending on parents' income",
    "Not dependent on grades; the amount is based on the parents' income",
    "Nicht zurückzuzahlen und bis zu 855 € im Monat, einkommensabhängig",
  ]) assert.equal(incomeDependent(text), true, text);
  // The Deutschlandstipendium card no longer claims an income test.
  const deutschland = moneyLine([component({ amount_min_minor: 30000, amount_max_minor: 30000,
    description: "300 € im Monat; nicht als Einkommen bei Sozialleistungen angerechnet." })], [])!;
  assert.equal(deutschland.note, "");
});

test("a round that is over says closed and never counts negative days", () => {
  const today = "2026-10-27";
  // The calendar moved past the deadline of a call stored as open.
  const passed = timing({ applicationStatus: "open", effectiveState: "closed", deadlineOn: "2026-10-25", windows: [window({ deadline_on: "2026-10-25" })] }, today);
  assert.deepEqual([passed.pill, passed.label, passed.cell.value, passed.cell.sub, passed.left], ["closed", "Bewerbung geschlossen", "25. Okt.", "vorbei", null]);
  // Even when the effective state was not sent, a past deadline never reads "noch -2 Tage".
  const stale = timing({ applicationStatus: "open", effectiveState: null, deadlineOn: "2026-10-25", windows: [window({ deadline_on: "2026-10-25" })] }, today);
  assert.equal(stale.pill, "closed");
  assert.doesNotMatch(stale.cell.sub, /-/);
  const noDate = timing({ applicationStatus: "closed", effectiveState: "closed", deadlineOn: null, windows: [] }, today);
  assert.deepEqual([noDate.pill, noDate.cell.value], ["closed", "vorbei"]);
  // Closed calls sort after open, later and per-group ones.
  assert.ok(passed.sort > 4);
});
