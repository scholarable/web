import assert from "node:assert/strict";
import test from "node:test";
import { browseFilters, browseHref, browsePageHref, browseQuery, browseSubjectsQuery, CATALOGUE_CAPACITY, mentionedValues, positiveGroupIds } from "../lib/browse";
import { scopeDe } from "../lib/copy-de";
import { MATCHING_CALLS_QUERY } from "../lib/matches.server";
import { browseServingCalls, servingCall, servingQuery, subjectChoices } from "../lib/serving.server";

test("bounded pagination preserves filters and drops unrelated parameters", () => {
  const filters = browseFilters(new URL("https://example.test/scholarships?q=  grant &status=open&page=2&secret=drop"));
  assert.deepEqual(filters, { search: "grant", degree: "", subject: "", openOnly: true, family: "", soonOnly: false, byAmount: false, page: 2 });
  // The family filter lists one declared family call by call; only a plain key is accepted.
  assert.equal(browseFilters(new URL("https://example.test/?family=deutschlandstipendium")).family, "deutschlandstipendium");
  assert.equal(browseFilters(new URL("https://example.test/?family=Deutschland%20Stipendium")).family, "");
  assert.equal(browseHref("/scholarships", { ...filters, family: "deutschlandstipendium" }, { degree: "master" }), "/scholarships?q=grant&degree=master&family=deutschlandstipendium&status=open");
  assert.equal(browsePageHref(filters, 1), "/scholarships?q=grant&status=open&page=1");
  assert.equal(browsePageHref(filters, 0), "/scholarships?q=grant&status=open");
  // Status, level and order are links that keep the other choices and start again at page one.
  const soon = browseFilters(new URL("https://example.test/?status=soon&sort=amount&degree=master&page=3"));
  assert.deepEqual([soon.openOnly, soon.soonOnly, soon.byAmount], [false, true, true]);
  assert.equal(browsePageHref(soon, 1), "/scholarships?degree=master&status=soon&sort=amount&page=1");
  assert.equal(browseHref("/", soon, { openOnly: true, soonOnly: false }, "#list"), "/?degree=master&status=open&sort=amount#list");
  assert.equal(browseHref("/", soon, { degree: "", byAmount: false }), "/?status=soon");
  assert.equal(browseFilters(new URL("https://example.test/?status=later&sort=random")).soonOnly, false);
  for (const page of ["NaN", "Infinity", "-1", "1.5", "1001"]) assert.equal(browseFilters(new URL(`https://example.test/?page=${page}`)).page, 0);
});
test("query searches reviewed provider names, loads every match up to the capacity and parameterizes user input", () => {
  const filters = { degree: "master", subject: "engineering", search: "'); drop table sources;--", openOnly: true, family: "", soonOnly: false, byAmount: false, page: 3 };
  const query = browseQuery(filters);
  assert.equal(query.text.includes(filters.search), false);
  assert.match(query.text, /with listed as materialized \(select \* from apply_now_calls\)/);
  assert.match(query.text, /from listed r join details d on d\.call_id = r\.id/);
  assert.match(query.text, /provider_name/);
  // Every listed call says which declared family it belongs to, and names the
  // universities and taxonomy subjects it is only for; the family filter is a parameter.
  assert.match(query.text, /f\.family, coalesce\(nu\.names, f\.institutions, '\[\]'::jsonb\) as institutions, coalesce\(ns\.tags, '\[\]'::jsonb\) as taxonomy_tags,/);
  assert.match(query.text, /left join families f on f\.call_id = r\.id\s+left join named_universities nu on nu\.call_id = r\.id\s+left join named_subjects ns on ns\.call_id = r\.id\s+where \(\$5 = '' or f\.family = \$5\)/);
  assert.match(query.text, /named_universities as \(select call_id, jsonb_agg\(name order by name\) as names from universities group by call_id\)/);
  // Every match up to the capacity, plus one row to notice more: the page sorts and groups the whole list before paging it.
  assert.deepEqual(query.values, [filters.search, 1001, "master", "engineering", ""]);
  assert.match(query.text, /r\.id limit \$2`?$/);
  assert.doesNotMatch(query.text, /offset|count\(\*\) over/);
  assert.equal(browseQuery({ ...filters, family: "deutschlandstipendium" }).values[4], "deutschlandstipendium");
  assert.match(browseQuery({ ...filters, openOnly: false }).text, /with listed as materialized \(select \* from recommendation_ready_calls\)/);
  // Each listed call says whether it is in apply_now_calls ("Jetzt offen").
  assert.match(query.text, /true as apply_now\s+from listed r/);
  assert.match(browseQuery({ ...filters, openOnly: false }).text, /open_now as materialized \(select id from apply_now_calls\)/);
  assert.match(browseQuery({ ...filters, openOnly: false }).text, /r\.id in \(select a\.id from open_now a\) as apply_now\s+from listed r/);
  // A call naming no subject stays visible under a subject filter; one whose
  // rules name a subject shows only under that subject.
  assert.match(query.text, /or \(r\.subject_scope <> 'selected' and not exists \(/);
});
test("each serving view is read once per list or matching query, into a materialized CTE", () => {
  // Joined or correlated directly, the planner re-ran a view for every listed call:
  // 9.3 s for the list and 9.1 s for the matching calls at 56 calls (2026-10-27).
  const views = ["recommendation_ready_calls", "apply_now_calls", "public_call_details", "public_call_families",
    "matching_ready_calls", "public_call_subjects", "public_call_institutions"];
  const filters = browseFilters(new URL("https://example.test/?degree=master&subject=computer-science&family=x"));
  for (const text of [browseQuery(filters).text, browseQuery({ ...filters, openOnly: true }).text, MATCHING_CALLS_QUERY]) {
    for (const view of views) {
      const reads = text.match(new RegExp(`\\b${view}\\b`, "g"))?.length ?? 0;
      assert.ok(reads <= 1, `${view} is read ${reads} times`);
      if (reads) assert.match(text, new RegExp(`\\w+ as materialized \\(select [^()]*from ${view}\\)`), view);
    }
  }
});
test("the Fach choices show the taxonomy's German names and keep the codes as values", () => {
  assert.match(browseSubjectsQuery, /select distinct s\.code as subject, s\.name as label from public_call_subjects s/);
  assert.deepEqual(subjectChoices([{ subject: "biology", label: "Biologie" }, { subject: "computer_science", label: null }, { subject: "biology", label: null }]),
    [{ value: "biology", label: "Biologie" }, { value: "computer_science", label: null }]);
  // A rule value that is also a taxonomy code keeps the German name, whichever row comes first.
  assert.deepEqual(subjectChoices([{ subject: "biology", label: null }, { subject: "biology", label: "Biologie" }]), [{ value: "biology", label: "Biologie" }]);
  assert.equal(subjectChoices(Array.from({ length: 101 }, (_, index) => ({ subject: `s${index}`, label: null }))).length, 100);
  // A call limited to taxonomy subjects is listed under each subject, under its
  // whole Fächergruppe, and under every subject of a Fächergruppe it names.
  const query = browseQuery({ ...browseFilters(new URL("https://example.test/?subject=computer-science")) });
  assert.match(query.text, /s\.code = \$4 or s\.group_code = \$4/);
  assert.match(query.text, /s\.code in \(select g\.group_code from subjects g where g\.code = \$4\)/);
  assert.equal(query.values[3], "computer-science");
});
test("the scholarship page names a call's taxonomy subjects in German", async () => {
  const row = { id: "7", slug: "rise", title: "RISE", application_status: "open", subject_scope: "selected", details: null,
    taxonomy_subjects: ["Biologie", "Ingenieurwissenschaften", "Physik, Astronomie"] };
  const connect = async () => (async (sql: string) => sql.includes("public_call_subjects") ? [row] : []) as unknown as Awaited<ReturnType<typeof servingQuery>>;
  const result = await servingCall("rise", { SCHOLARABLE_SERVING_DATABASE_URL: "synthetic-test-boundary" }, connect);
  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  assert.deepEqual(result.scholarship.subjects, ["Biologie", "Ingenieurwissenschaften", "Physik, Astronomie"]);
  assert.equal(scopeDe("selected", "subjects", result.scholarship.subjects), "Nur diese Fächer: Biologie · Ingenieurwissenschaften · Physik, Astronomie");
  assert.equal(scopeDe("selected", "universities", ["TU München", "LMU München"]), "Nur diese Hochschulen: TU München, LMU München");
});
test("unavailable catalogue retains search controls but does not invent pages", async () => {
  const result = await browseServingCalls(new URL("https://example.test/?q=test&status=open&page=2"), undefined);
  assert.equal(result.state, "unavailable"); assert.equal(result.search, "test"); assert.equal(result.page, 2);
  assert.equal("scholarships" in result, false);
});
test("the list loads every listed call whatever the page, and more than the capacity fails visibly, never cut", async () => {
  const env = { SCHOLARABLE_SERVING_DATABASE_URL: "synthetic-test-boundary" };
  const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: String(index + 1), slug: `call-${index + 1}`, title: `Call ${index + 1}`, application_status: "open",
    institution_scope: "selected", institutions: ["Universität Bielefeld"], subject_scope: "selected",
    taxonomy_tags: [{ code: "biology", name: "Biologie", group: "mathematics-natural-sciences", group_name: "Mathematik, Naturwissenschaften" }, { code: "Bad Code", name: "x", group: null }] }));
  const connect = (count: number) => async () => (async (sql: string) => sql.includes("as subject") ? [] : rows(count)) as unknown as Awaited<ReturnType<typeof servingQuery>>;
  const page = await browseServingCalls(new URL("https://example.test/scholarships?page=1"), env, connect(190));
  if (page.state !== "ready") assert.fail("synthetic catalogue unavailable");
  assert.equal(page.scholarships.length, 190, "page two of the list still loads every call: the page sorts and pages them");
  assert.equal(page.total, 190);
  assert.deepEqual(page.scholarships[0].institutions, ["Universität Bielefeld"]);
  assert.deepEqual(page.scholarships[0].subjects, [{ code: "biology", name: "Biologie", group: "mathematics-natural-sciences", group_name: "Mathematik, Naturwissenschaften" }], "a malformed tag is dropped");
  assert.equal(page.scholarships[0].card.study.institutions, "selected");
  const over = await browseServingCalls(new URL("https://example.test/scholarships"), env, connect(CATALOGUE_CAPACITY + 1));
  assert.equal(over.state, "unavailable");
  if (over.state === "unavailable") assert.match(over.reason, /größer, als diese Seite anzeigen kann/);
});
test("the scholarship page names every university of a call that is only for some", async () => {
  const row = { id: "148", slug: "elsa-neumann", title: "Elsa-Neumann-Stipendium", application_status: "open", institution_scope: "selected", details: { provider_name: "Freie Universität Berlin" },
    listed_institutions: ["Freie Universität Berlin", "Humboldt-Universität zu Berlin", "Technische Universität Berlin", "Universität der Künste Berlin"] };
  let detailSql = "";
  const connect = async () => (async (sql: string) => { detailSql = sql; return [row]; }) as unknown as Awaited<ReturnType<typeof servingQuery>>;
  const result = await servingCall("elsa-neumann", { SCHOLARABLE_SERVING_DATABASE_URL: "synthetic-test-boundary" }, connect);
  if (result.state !== "ready") assert.fail("synthetic call unavailable");
  assert.match(detailSql, /from public_call_institutions i where i\.call_id = r\.id\) as listed_institutions/);
  assert.equal(scopeDe("selected", "universities", result.scholarship.institutions),
    "Nur diese Hochschulen: Freie Universität Berlin, Humboldt-Universität zu Berlin, Technische Universität Berlin, Universität der Künste Berlin");
});


test("cohort filter links survive pagination and hostile values remain parameters", () => {
  const filters = browseFilters(new URL("https://example.test/?degree=master&subject=engineering&q=grant&status=open&page=2"));
  assert.equal(browsePageHref(filters, 3), "/scholarships?q=grant&degree=master&subject=engineering&status=open&page=3");
  assert.equal(browseFilters(new URL("https://example.test/?degree=unknown")).degree, "");
  const hostile = browseFilters(new URL("https://example.test/?subject=" + encodeURIComponent("'); delete from scholarships;--")));
  assert.equal(browseQuery(hostile).text.includes(hostile.subject), false);
  assert.equal(browseQuery(hostile).values[3], hostile.subject);
});

test("facets mention positive structured values without claiming unknown or negative criteria match", () => {
  const requirements = [
    { criterion_key: "subject", kind: "required", operator: "eq", value: { expected: "engineering" } },
    { criterion_key: "subject", kind: "preferred", operator: "in", value: { expected: ["humanities", 42] } },
    { criterion_key: "subject", kind: "exclusion", operator: "eq", value: { expected: "excluded" } },
    { criterion_key: "subject", kind: "required", operator: "neq", value: { expected: "negative" } },
    { criterion_key: "subject", kind: "manual_review", operator: "eq", value: { expected: "unknown" } },
    { criterion_key: "subject", kind: "required", operator: "eq", value: {} },
  ];
  assert.deepEqual(mentionedValues({ requirements }, "subject"), ["engineering", "humanities"]);
  assert.deepEqual(mentionedValues({}, "degree_level"), []);
});

test("facets count rules from positive application groups and nothing from negative, renewal or broken groups", () => {
  const rule = (id: string, expected: string, group_id: string | null) => ({ id, criterion_key: "degree_level", kind: "required", operator: "eq", value: { expected }, group_id });
  const groups = [
    { id: "either", logic: "any", applies_to: "application" },
    { id: "nested", logic: "all", applies_to: "application", parent_id: "either" },
    { id: "excluded", logic: "none", applies_to: "application" },
    { id: "renewal", logic: "all", applies_to: "renewal" },
    { id: "under-renewal", logic: "any", applies_to: "application", parent_id: "renewal" },
    { id: "loop-a", logic: "all", parent_id: "loop-b" }, { id: "loop-b", logic: "all", parent_id: "loop-a" },
    { id: "twin", logic: "all" }, { id: "twin", logic: "any" },
  ];
  assert.deepEqual([...positiveGroupIds({ groups })].sort(), ["either", "nested"]);
  const requirements = [
    rule("plain", "bachelor", null), rule("alt", "master", "either"), rule("deep", "doctoral", "nested"),
    rule("neg", "excluded-level", "excluded"), rule("later", "renewal-level", "renewal"), rule("inherited", "renewal-child", "under-renewal"),
    rule("cycle", "loop-level", "loop-a"), rule("dup", "twin-level", "twin"), rule("orphan", "orphan-level", "missing"),
  ];
  assert.deepEqual(mentionedValues({ groups, requirements }, "degree_level"), ["bachelor", "master", "doctoral"]);
  // A chain deeper than eight levels is not followed.
  const chain = Array.from({ length: 9 }, (_, index) => ({ id: `g${index}`, logic: "all", parent_id: index ? `g${index - 1}` : null }));
  assert.equal(positiveGroupIds({ groups: chain }).has("g7"), true);
  assert.equal(positiveGroupIds({ groups: chain }).has("g8"), false);
  // The SQL twin walks the same chain inside the facet predicate.
  const text = browseQuery(browseFilters(new URL("https://example.test/?degree=master"))).text;
  assert.match(text, /with recursive chain/);
  assert.match(text, /node->>'logic' in \('all', 'any'\)/);
});
