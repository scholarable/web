import { demoMode } from "../lib/demo-mode";
import { Form, Link, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/scholarships";
import { browseServingCalls } from "../lib/serving.server";
import { browsePageHref } from "../lib/browse";
import { requireStudentAuth, studentAuthEnv, studentAuthLoader, studentAuthReady, studentConnection } from "../lib/student-auth.server";
import { readStudentProgress } from "../lib/student-progress.server";
import { useAnswers } from "../lib/discovery-answers";
import { dateLong } from "../lib/copy-de";
import { CardList, familyTitle, ListSummary, ListTools } from "../components/scholarship-list";

export const headers = () => ({ "Cache-Control": "no-store" });
export const meta = () => [{ title: "Alle Stipendien | Scholarable" }];

export async function loader(args: Route.LoaderArgs) {
  const { request, context } = args;
  const env = (context as { cloudflare?: { env?: object } }).cloudflare?.env;
  const base = { ...await browseServingCalls(new URL(request.url), env), studentAccounts: studentAuthReady(request, studentAuthEnv(context)), signedIn: false, savedIds: [] as string[] };
  if (!base.studentAccounts) return base;
  try {
    requireStudentAuth(request, studentAuthEnv(context));
    return await studentAuthLoader<typeof base>(args, async ({ auth, getAccessToken }) => {
      if (!auth.user?.emailVerified || auth.impersonator) return base;
      const token = getAccessToken();
      if (!token) return base;
      const { query, digest } = await studentConnection(context, auth.user.id, token);
      const progress = await readStudentProgress(query, digest);
      return { ...base, signedIn: true, savedIds: progress.opportunities.filter(item => item.disposition === "saved").map(item => String(item.call_id)) };
    });
  } catch { return base; }
}

export default function Scholarships() {
  const data = useLoaderData<typeof loader>();
  const answers = useAnswers();
  const navigation = useNavigation();
  const searching = navigation.state !== "idle";
  const items = data.state === "ready" ? data.scholarships : [];
  const level = answers.result && answers.facts.degree_level ? answers.facts.degree_level : null;
  // Sorted by the chat's answers: say so and lead back to change them.
  const sorted = !!answers.result && !demoMode && !data.family;
  const filtered = !!(data.search || data.openOnly || data.soonOnly || data.degree || data.subject || data.family);
  const lastChecked = items.map(item => item.lastChecked).filter((value): value is string => !!value).sort().at(-1);
  return <main className="list list-page">
    <div className="list-head"><h1>{demoMode ? "Beispiel-Stipendien" : data.family ? `${familyTitle(data.family)} an jeder Hochschule` : sorted ? "Für dich sortiert" : "Alle Stipendien"}</h1>
      <p className="lede">{demoMode ? "Erfundene Beispiele zum Ausprobieren von Liste, Seite und Abgleich." : data.family ? "Jede Hochschule vergibt es selbst, mit eigenen Fristen, Regeln und Unterlagen. Such deine Hochschule heraus; maßgeblich bleibt ihre Seite."
        : sorted ? <>Nach deinen Antworten im Chat: Was laut den geprüften Regeln passt, steht oben. <Link className="text-link" to="/">Antworten ändern</Link></>
        : "Jedes Stipendium hier ist mit den offiziellen Seiten abgeglichen. Merk dir, was dir gefällt; maßgeblich bleibt die Seite des Anbieters."}</p>
      {items.length > 0 && <ListSummary items={items} total={data.state === "ready" ? data.total : items.length} soonOnly={data.soonOnly} />}</div>
    <Form key={JSON.stringify([data.search, data.subject])} className="filters" method="get" role="search">
      <label>Suche<input name="q" type="search" maxLength={120} defaultValue={data.search} placeholder="Anbieter oder Name" /></label>
      {data.subjects.length > 0 && <label>Fach<select name="subject" defaultValue={data.subject}><option value="">Alle Fächer</option>{data.subject && !data.subjects.some(subject => subject.value === data.subject) && <option value={data.subject}>{data.subject.replaceAll("_", " ")}</option>}{data.subjects.map(subject => <option key={subject.value} value={subject.value}>{subject.label ?? subject.value.replaceAll("_", " ")}</option>)}</select></label>}
      {data.degree && <input type="hidden" name="degree" value={data.degree} />}
      {data.family && <input type="hidden" name="family" value={data.family} />}
      {(data.openOnly || data.soonOnly) && <input type="hidden" name="status" value={data.openOnly ? "open" : "soon"} />}
      {data.byAmount && <input type="hidden" name="sort" value="amount" />}
      <button className="btn dark" disabled={searching}>{searching ? "Sucht …" : "Suchen"}</button>
    </Form>
    <ListTools path="/scholarships" filters={data} />
    <details className="filter-note"><summary>Wie die Auswahl funktioniert</summary><p>„Jetzt offen“ zeigt die Stipendien, bei denen du dich gerade bewerben kannst. „Bachelor“, „Master“ und „Promotion“ zeigen zuerst die Stipendien, deren Regeln dieses Studienniveau nennen. Stipendien ohne Angabe bleiben in der Liste, darunter unter „Studienniveau nicht angegeben“; nur wer laut Regeln ein anderes Niveau verlangt oder es ausschließt, fällt heraus. Ein Stipendium ohne Fächer-Einschränkung erscheint unter jedem Fach. Hast du im Chat deine Hochschule oder dein Fach genannt oder gesagt, dass du schon in Deutschland lebst, stehen Stipendien nur für andere Hochschulen, andere Fächer oder Bewerbungen aus dem Ausland ganz unten, eingeklappt. Für einen persönlichen Abgleich nutze den Chat auf der Startseite.</p></details>
    {searching && <p role="status">Die Liste wird durchsucht …</p>}
    {filtered && <Link className="btn link" to="/scholarships">Auswahl zurücksetzen</Link>}
    {data.state === "unavailable" ? <section className="notice" role="status"><h2>Liste gerade nicht verfügbar</h2><p>{data.reason}</p></section>
      : items.length === 0 ? <section className="notice"><h2>{demoMode ? "Keine Beispiele gefunden" : "Keine Stipendien gefunden"}</h2><p>{demoMode ? "Versuch eine andere Suche oder setz die Auswahl zurück, um die erfundenen Beispiele zu sehen." : "Versuch eine andere Suche oder schau wieder vorbei, wenn neue geprüfte Stipendien dazukommen."}</p></section>
      : <CardList items={items} result={answers.result} level={level} filterLevel={data.degree} soonOnly={data.soonOnly} byAmount={data.byAmount} save={{ studentAccounts: data.studentAccounts, signedIn: data.signedIn, savedIds: data.savedIds }}
        institution={answers.facts.institution || null} subject={answers.facts.subject || null} abroad={answers.facts.abroad || null} grouped={!data.search && !data.family}
        pages={{ page: data.page, href: page => browsePageHref(data, page) }} />}
    {items.length > 0 && <p className="quiet-line">{lastChecked ? `Zuletzt geprüft am ${dateLong(lastChecked)}. ` : ""}Nur Angaben von den offiziellen Seiten der Anbieter.{answers.result ? " Regelbasierter Abgleich, keine Entscheidung über deine Berechtigung." : ""}</p>}
  </main>;
}
