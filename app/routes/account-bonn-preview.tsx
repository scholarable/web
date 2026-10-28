import { authkitLoader } from "@workos-inc/authkit-react-router";
import { Link } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/account-bonn-preview";
import { bonnApplicationUrl, bonnPreviewDeadlines, bonnPreviewTitle, bonnProgrammeUrl } from "../lib/account-bonn-preview";
import { sampleAccountAllowed } from "../lib/account-sample";
import { requireStudentAuth, studentAuthEnv } from "../lib/student-auth.server";

export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
export const meta = () => [{ title: "Bonn PROMOS, private Vorschau | Scholarable" }];

export async function loader(args: Route.LoaderArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context));
  return authkitLoader(args, async ({ auth }) => {
    if (!auth.user.emailVerified || auth.impersonator
      || !sampleAccountAllowed(auth.user.email, studentAuthEnv(args.context)?.SCHOLARABLE_TEST_ACCOUNT_EMAIL)) {
      throw new Response("Not found", { status: 404 });
    }
    return null;
  }, { ensureSignedIn: true });
}

export default function AccountBonnPreview() {
  const [cohort, setCohort] = useState("");
  const [transcriptReady, setTranscriptReady] = useState(false);
  const [note, setNote] = useState("");
  const deadline = bonnPreviewDeadlines.find((item) => item.id === cohort);
  return <main className="page-wrap account-page">
    <p className="kicker">Private Testvorschau · echter Anbieter</p>
    <h1>{bonnPreviewTitle}</h1>
    <p className="lede">Anbieterseiten geprüft am 27. September 2026: Bonn nennt zwei Fristen für 2027, sagt aber, dass die Bewerbung im Herbst öffnet. Dieses Stipendium ist in Scholarables Liste nicht geprüft und nicht veröffentlicht.</p>
    <p className="notice"><strong>Nur zum Testen.</strong> Dein Merkzeichen bleibt in diesem Browser. Die Auswahl und die Notiz unten verschwinden, wenn du die Seite verlässt; sie werden nicht in deinem Konto gespeichert und nicht an Bonn geschickt. Gib keine persönlichen Angaben ein.</p>
    <section><h2>Eine mögliche Bewerbung planen</h2>
      <label>Wann würde dein Projekt beginnen?
        <select value={cohort} onChange={(event) => setCohort(event.target.value)}>
          <option value="">Zeitraum wählen</option>
          {bonnPreviewDeadlines.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <p role="status">{deadline ? `Frist laut Anbieter: ${deadline.date}. Prüf sie bei Bonn, bevor du etwas tust.` : "Wähl einen Zeitraum, um die Frist des Anbieters zu sehen."}</p>
      <label><input type="checkbox" checked={transcriptReady} onChange={(event) => setTranscriptReady(event.target.checked)} /> Übungsliste: Notenübersicht fertig</label>
      <p>Notenübersicht: {transcriptReady ? "in diesem Tab als fertig markiert" : "nicht als fertig markiert"}. Alle Dokumente, die du brauchst, stehen in Bonns Liste für die jeweilige Förderlinie.</p>
      <label htmlFor="bonn-preview-note">Übungsnotiz (nur erfundene Angaben)</label>
      <textarea id="bonn-preview-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={4} placeholder="Zum Beispiel: Bonn fragen, welche Förderlinie passt" />
      <p>{note ? "Die Notiz bleibt nur in diesem Tab." : "Noch keine Notiz."}</p>
    </section>
    <section><h2>Stand der Bewerbung</h2>
      <p><span className="status needs_confirmation">Noch nicht offen</span></p>
      <p>Bonn nennt Mobility-Online als Bewerbungsportal, sagt aber, dass die Bewerbung für 2027 im Herbst öffnet. In dieser Vorschau kannst du dich nicht bewerben und nichts einreichen.</p>
      <p><a className="text-link" href={bonnProgrammeUrl} target="_blank" rel="noopener noreferrer">PROMOS bei der Universität Bonn</a> · <a className="text-link" href={bonnApplicationUrl} target="_blank" rel="noopener noreferrer">Bonns Hinweise zur Bewerbung</a></p>
    </section>
    <p><Link className="text-link" to="/account">Zurück zu Gemerkt</Link></p>
  </main>;
}
