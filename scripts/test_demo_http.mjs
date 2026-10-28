import assert from "node:assert/strict";
const base = new URL(process.argv[2] || "http://127.0.0.1:5197");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) || (process.argv.includes("--remote") && base.protocol === "https:"), "Remote demo testing requires explicit --remote and HTTPS");
const localPreview = process.argv.includes("--local-preview");
assert.ok(!localPreview || ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "Local preview checks require loopback");
async function page(path, status = 200) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, status, path);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  const html = await response.text();
  if (!localPreview) assert.match(html, /Demo mit erfundenen Daten/);
  else assert.doesNotMatch(html, /class="demo-banner"/);
  return html;
}
const home = await page("/");
assert.match(home, /aria-label="Weitere Links"><a href="\/match\?mode=form">Lieber ein Formular/);
assert.doesNotMatch(home, /A clearer way to find your way|class="discovery-note"/);
assert.match(await page("/match?mode=form"), /Bist du 18 oder älter\?/);
if (!localPreview) assert.match(home, /Vier erfundene Stipendien/);
else {
  const navigation = home.match(/<nav class="site-nav"[^>]*>(.*?)<\/nav>/s)?.[1] || "";
  assert.match(navigation, /Stipendien/);
  assert.doesNotMatch(navigation, /Gemerkt|Profil/);
  assert.doesNotMatch(home, /Gemerkte Beispiele|Beispielangaben nutzen/);
}
const browse = await page("/scholarships");
for (const slug of ["demo-bachelor", "demo-master", "demo-doctoral", "demo-exchange"]) {
  assert.ok(browse.includes(`/scholarships/${slug}`));
  const detail = await page(`/scholarships/${slug}`);
  assert.match(detail, /Passt der Zeitraum\?/);
  assert.match(detail, /Erfundenes Beispiel/);
  assert.match(detail, /Alles hier ist erfunden/);
  assert.match(detail, /Sample reference/);
  assert.match(detail, /Wenn zutreffend/);
  // Every reviewed funding component is listed, priced or not.
  for (const text of ["Reisekosten", "500\u00a0€", "pro Reise", "wenn zutreffend", "Mentoring", "Angebot ohne Geldbetrag", "Fictional travel allowance"]) assert.ok(detail.includes(text), text);
}
// The list groups by status; status, level and order are links that work without the page's script.
assert.match(browse, /id="group-open">Jetzt offen <span class="count">3<\/span><\/h2>/);
assert.match(browse, /id="group-soon">Öffnet bald <span class="count">1<\/span><span class="hint"> Frist steht schon fest<\/span>/);
assert.match(browse, /<a class="filter-chip"[^>]*href="\/scholarships\?status=soon"/);
const soon = await page("/scholarships?status=soon");
assert.match(soon, /href="\/scholarships\/demo-exchange"/);
assert.doesNotMatch(soon, /href="\/scholarships\/demo-bachelor"/);
const open = await page("/scholarships?status=open&sort=amount");
assert.ok(open.indexOf("/scholarships/demo-master") < open.indexOf("/scholarships/demo-bachelor"), "nach Betrag: 500 € before 300 € a month");
assert.doesNotMatch(open, /href="\/scholarships\/demo-exchange"/);
const filtered = await page("/scholarships?q=Undergraduate");
assert.match(filtered, /href="\/scholarships\/demo-bachelor"/);
assert.doesNotMatch(filtered, /href="\/scholarships\/demo-master"/);
const studyFiltered = await page("/scholarships?degree=bachelor&subject=computer_science");
assert.match(studyFiltered, /href="\/scholarships\/demo-bachelor"/);
assert.doesNotMatch(studyFiltered, /href="\/scholarships\/demo-master"/);
assert.match(await page("/scholarships?degree=bachelor&subject=engineering"), /Keine Beispiele gefunden/);
assert.match(await page("/scholarships?q=no-such-opportunity"), /Keine Beispiele gefunden/);
await page("/scholarships/no-such-opportunity", 404);
assert.match(await page("/match"), /Example University/);
assert.match(await page("/my-plan"), /nur die IDs der erfundenen Stipendien/);
const privacy = await page("/privacy");
assert.match(privacy, /ohne Datenbankverbindung/);
assert.doesNotMatch(privacy, /Restricted preview sign-in/);
const report = await page("/report?call=demo-bachelor");
assert.match(report, /Erfundenes Beispiel, kein geprüftes Stipendium/);
assert.match(report, /demo-bachelor/);
assert.match(await page("/report?call=demo-exchange"), /demo-exchange/);
await page("/report");
const fact = value => ({value, value_state:value === null ? "unknown" : "known", confirmation_state:"confirmed"});
const profile = {facts:{adult_confirmation:fact(true), institution:fact("Example University"), degree_level:fact("bachelor"), subject:fact("computer_science"), semester_number:fact(null), milestone:fact("thesis")}};
async function match(origin = base.origin) {
  return fetch(new URL("/api/matches", base), {signal:AbortSignal.timeout(10000),method:"POST", headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({profile})});
}
let response = await match();
assert.equal(response.status, 200);
assert.match(response.headers.get("cache-control"), /no-store/);
let result = await response.json();
let included = result.recommendations.filter(item => item.status !== "mismatch");
assert.equal(included.length, 1);
assert.equal(included[0].call_id, "demo-bachelor");
assert.equal(included[0].status, "match");
profile.facts.semester_number = fact(3);
profile.facts.milestone = fact("exchange");
result = await (await match()).json();
included = result.recommendations.filter(item => item.status !== "mismatch");
assert.deepEqual(included.map(item => item.call_id), ["demo-bachelor", "demo-exchange"]);
assert.equal(included[1].openingOn, "2028-04-01");
profile.facts.semester_number = fact(null);
profile.facts.milestone = fact("thesis");
profile.facts.subject = fact(null);
result = await (await match()).json();
assert.equal(result.recommendations[0].status, "needs_confirmation");
assert.equal(result.recommendations[0].actionable, false);
assert.ok(result.followUps.some(question => question.field === "subject"));
profile.facts.subject = {value:null, value_state:"prefer_not_to_say", confirmation_state:"confirmed"};
result = await (await match()).json();
assert.equal(result.recommendations[0].status, "needs_confirmation");
assert.ok(!result.followUps?.some(question => question.field === "subject"));
profile.facts.subject = fact("engineering");
result = await (await match()).json();
assert.ok(result.recommendations.length > 0);
assert.ok(result.recommendations.every(item => item.status === "mismatch"));
assert.ok(result.recommendations.some(item => item.criteria.mismatched.some(criterion => criterion.id === "subject")));
assert.equal((await match("https://example.invalid")).status, 403);
console.log("Demo HTTP checks passed: browse/search/detail/404/profile/matches/unknown/mismatch/privacy/report/origin/no-store.");
