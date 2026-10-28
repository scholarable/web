import { useEffect, useState } from "react";
import { dateProblem, planningWindows } from "../lib/activity-planning";
import { deadlineWords, openingWords } from "../lib/copy-de";
import type { PublicDetails } from "../lib/public-details";

const problemDe: Record<string, string> = {
  "Enter valid official activity dates.": "Gib gültige Daten für dein Vorhaben ein.",
  "The activity end date must be on or after its start date.": "Das Ende muss am oder nach dem Start liegen.",
};

// "Passt der Zeitraum?": optional planning answers that stay in this page and
// are never sent anywhere. They cannot establish eligibility.
export function ActivityCheck({ details }: { details: PublicDetails }) {
  const [ready, setReady] = useState(false);
  const [adult, setAdult] = useState(false);
  const [track, setTrack] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [destination, setDestination] = useState("");
  const [shown, setShown] = useState(false);
  function forget() { setAdult(false); setTrack(""); setStart(""); setEnd(""); setDestination(""); setShown(false); }
  useEffect(() => {
    setReady(true);
    window.addEventListener("pagehide", forget);
    const expiry = window.setInterval(forget, 24 * 60 * 60 * 1000);
    return () => { window.removeEventListener("pagehide", forget); window.clearInterval(expiry); };
  }, []);
  const problem = dateProblem(start, end);
  const windows = planningWindows(details, track, details.routes);
  return <section className="sec activity-check" aria-labelledby="activity-heading">
    <h2 id="activity-heading">Passt der Zeitraum?</h2>
    <p>Plan dein Vorhaben und sieh dir die veröffentlichten Fristen an. Alle anderen Bedingungen musst du trotzdem prüfen.</p>
    <p className="fine">Diese freiwilligen Angaben bleiben auf dieser Seite und gehen nicht an Scholarable. Lösch sie hier, oder verlass oder lade die Seite neu. Nach spätestens 24 Stunden sind sie weg.</p>
    <noscript><p>Für diese Planung brauchst du JavaScript. Die offiziellen Angaben oben siehst du auch so.</p></noscript>
    {/* No form or input names: Enter cannot send answers in a URL before hydration. */}
    <fieldset className="plan-form" disabled={!ready} onChange={() => setShown(false)}>
      <legend>Dein Vorhaben</legend>
      <label className="choice-line"><input type="checkbox" checked={adult} onChange={e => { setAdult(e.target.checked); if (!e.target.checked) forget(); }} /> Ich bin 18 oder älter</label>
      <fieldset disabled={!adult}>
        <label>Wofür möchtest du Förderung?<select value={track} onChange={e => setTrack(e.target.value)}>
          <option value="">Weiß ich noch nicht oder möchte ich nicht sagen</option>
          {details.tracks.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select><span>Wähl eine Gruppe, die der Anbieter nennt. Leer lassen, wenn sie nicht dabei ist.</span></label>
        <label>Offizieller Start<input type="date" min="1900-01-01" max="2200-12-31" value={start} autoComplete="off" onInput={e => { setStart(e.currentTarget.value); setShown(false); }} /><span>Ohne Reisetage. Leer lassen, wenn du es nicht weißt.</span></label>
        <label>Offizielles Ende<input type="date" min="1900-01-01" max="2200-12-31" value={end} autoComplete="off" onInput={e => { setEnd(e.currentTarget.value); setShown(false); }} /></label>
        <label>Zielland oder Region (freiwillig)<input type="text" maxLength={160} value={destination} autoComplete="off" onChange={e => setDestination(e.target.value)} /><span>Nur eine Notiz. Einschränkungen für Ziele werden hier nicht geprüft.</span></label>
        <button className="btn dark sm" type="button" onClick={() => setShown(true)}>Fristen ansehen</button>
      </fieldset>
      <button className="btn link" type="button" onClick={forget}>Angaben löschen</button>
    </fieldset>
    {shown && adult && <div className="notice" role="status">
      {problem ? <p className="form-error">{problemDe[problem] || problem}</p> : <>
        <h3>Die Bedingungen musst du noch prüfen</h3>
        <p>{start && end ? "Deine Daten sind in der richtigen Reihenfolge. " : "Deine Daten sind noch nicht vollständig. "}Das sagt nichts darüber, ob die Dauer oder der Weg passt.</p>
        <p>{destination ? "Dein Ziel ist nicht mit den Regeln des Anbieters abgeglichen." : "Ein Ziel ist nicht angegeben."}</p>
        <p>Diese Fristen gelten für die gewählte Gruppe. Prüf beim Anbieter, für wen sie gelten; dein Startdatum wählt keine Frist aus.</p>
        {windows.length ? <ul className="activity-windows">{windows.map(w => <li key={w.id}>
          <strong>{deadlineWords(w).text}</strong>
          {w.route_id && <p>{details.routes.find(r => r.id === w.route_id)?.label}</p>}
          {w.audience && <p>{w.audience}</p>}
          {w.provider_text && <p>{w.provider_text}</p>}
          <p>{openingWords(w)}</p>
        </li>)}</ul> : <p>Für diese Auswahl gibt es keine geprüfte Bewerbungsfrist.</p>}
        <p>Prüf Einschreibung, Bedingungen für dein Vorhaben, andere Förderungen und den offiziellen Weg, bevor du dich bewirbst.</p>
      </>}
    </div>}
  </section>;
}
