import { useEffect, useState } from "react";
import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/my-plan";
import { demoMode, publicDemoMode } from "../lib/demo-mode";
import { demoProgressChanged, readDemoProgress, removeDemoProgress, sampleOutcomes, sampleStates, saveDemoProgress, setDemoOutcome, type SavedSample, type SampleOutcome, type SampleState } from "../lib/demo-progress";
import { deadlineWatch, todayInBerlin } from "../lib/deadline-watch";
import { DeadlineWatch } from "../components/deadline-watch";

export async function loader(_: Route.LoaderArgs) {
  if (!demoMode) throw new Response("Not found", { status: 404 });
  const { demoCalls } = await import("../lib/demo-catalogue.server");
  const today = todayInBerlin();
  return demoCalls.map(({ id, title, slug, details }) => ({ id, title, slug, dates: deadlineWatch(details, today) }));
}

export default function MyPlan() {
  const calls = useLoaderData<typeof loader>();
  const [saved, setSaved] = useState<SavedSample[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    try { setSaved(readDemoProgress(window.localStorage).filter((item) => calls.some((call) => call.id === item.id))); }
    catch { setError("Dieser Browser kann die gemerkten Beispiele nicht lesen."); }
    setReady(true);
  }, [calls]);
  function change(id: string, state: SampleState | null) {
    try {
      setSaved((state ? saveDemoProgress(window.localStorage, id, state) : removeDemoProgress(window.localStorage, id))
        .filter((item) => calls.some((call) => call.id === item.id)));
      window.dispatchEvent(new Event(demoProgressChanged));
      setError(null);
    } catch { setError("Dieser Browser kann die Beispiele nicht ändern."); }
  }
  function changeOutcome(id: string, outcome: SampleOutcome | null) {
    try { setSaved(setDemoOutcome(window.localStorage, id, outcome)); setError(null); }
    catch { setError("Dieser Browser kann das Beispiel-Ergebnis nicht ändern."); }
  }
  const dates = saved.flatMap(item => { const call = calls.find(candidate => candidate.id === item.id); return call?.dates.map(date => ({ callId: call.id, title: call.title, slug: call.slug, date })) || []; })
    .sort((a, b) => a.date.date.localeCompare(b.date.date)).slice(0, 10);
  const stateWords: Record<string, string> = { planned: "Geplant", preparing: "In Vorbereitung", submitted: "Abgeschickt", interview: "Auswahlgespräch", decision: "Warte auf Entscheidung", completed: "Abgeschlossen" };
  const outcomeWords: Record<string, string> = { accepted: "Angenommen", rejected: "Nicht ausgewählt", waitlisted: "Warteliste", withdrawn: "Zurückgezogen" };
  return <main className="mine"><div className="mine-head">{publicDemoMode && <p className="quiet-line">Demo · erfundene Daten</p>}<h1>{publicDemoMode ? "Gemerkte Beispiele" : "Gemerkt"}</h1>
    <p className="lede">In diesem Browser werden nur die IDs der erfundenen Stipendien und deine Beispiel-Stände gespeichert. Kein Konto, keine E-Mail-Erinnerung, keine echte Bewerbung. Wenn du die Browserdaten löschst, ist die Liste weg.</p></div>
    <div className="mine-main">
    {error && <p className="form-error" role="alert">{error}</p>}
    {!ready ? <p role="status">Beispiele werden geladen …</p> : saved.length === 0 ? <div className="empty"><p>Noch keine Beispiele gemerkt.</p><Link className="btn link" to="/">Beispiele finden</Link></div>
      : <><DeadlineWatch items={dates} sample /><section className="saved" aria-labelledby="saved-h"><h2 id="saved-h">Deine Beispiele ({saved.length})</h2>{saved.map((item) => {
        const call = calls.find((candidate) => candidate.id === item.id);
        if (!call) return null;
        return <article className="scard" key={item.id}><h3>{call.title}</h3>
          <label>Beispiel-Stand<select value={item.state} onChange={(event) => change(item.id, event.target.value as SampleState)}>
            {sampleStates.map((state) => <option key={state} value={state}>{stateWords[state] || state}</option>)}
          </select></label>
          <label>Beispiel-Ergebnis<select value={item.outcome || ""} onChange={(event) => changeOutcome(item.id, (event.target.value || null) as SampleOutcome | null)}>
            <option value="">Noch nichts</option>{sampleOutcomes.map((outcome) => <option key={outcome} value={outcome}>{outcomeWords[outcome] || outcome}</option>)}
          </select></label>
          <p className="fine">Das sind deine eigenen Beispiel-Notizen, keine Bewerbung und keine Antwort eines Anbieters.</p>
          <div className="scard-row"><Link className="btn link" to={`/scholarships/${encodeURIComponent(call.slug)}`}>Beispiel ansehen</Link>
            <button className="btn link quiet" type="button" onClick={() => change(item.id, null)}>Beispiel entfernen</button></div>
        </article>;
      })}</section></>}
    </div>
  </main>;
}
