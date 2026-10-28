import { useState } from "react";
import { data, Form, useActionData, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/report";
import { readBoundedForm, submitCatalogueReport } from "../lib/catalogue-reports.server";
import { isSampleReference, parseCatalogueReport, REPORT_NOTE_LIMIT, REPORT_REASONS, reportDraft, reportHref, reportReference, SUPPORT_EMAIL, type ReportOutcome, type ReportReason } from "../lib/reporting";
import type { ServingEnv } from "../lib/serving.server";
import { dateLong } from "../lib/copy-de";
import { requireSameOriginPost } from "../lib/student-auth.server";

export function meta() { return [{ title: "Fehler melden | Scholarable" }]; }
export function headers() { return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }; }

export async function action({ request, context }: Route.ActionArgs) {
  requireSameOriginPost(request);
  if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) throw new Response("Form encoding required", { status: 415 });
  // Oversized bodies are refused while streaming and still get the inline fallback.
  const form = await readBoundedForm(request);
  if (!form) return data({ outcome: "rejected" as ReportOutcome }, { status: 413 });
  const report = parseCatalogueReport(form);
  if (!report) return data({ outcome: "rejected" as ReportOutcome }, { status: 400 });
  const outcome = await submitCatalogueReport((context as { cloudflare?: { env?: ServingEnv } }).cloudflare?.env, report);
  return data({ outcome }, { status: outcome === "stored" ? 200 : outcome === "limited" ? 429 : outcome === "rejected" ? 400 : 503 });
}

export default function Report() {
  const [params] = useSearchParams();
  const result = useActionData() as { outcome?: ReportOutcome } | undefined;
  const busy = useNavigation().state !== "idle";
  const reference = reportReference(params.get("call"), params.get("version"));
  const [reason, setReason] = useState<ReportReason>("stale");
  const storable = !!reference && !isSampleReference(reference.callId);
  const stored = result?.outcome === "stored";
  const failed = !!result && !stored;
  return <main className="page-wrap"><h1>Falsche oder veraltete Angabe melden</h1>
    {reference ? <p>Stipendium {reference.callId}. {isSampleReference(reference.callId) ? "Erfundenes Beispiel, kein geprüftes Stipendium." : `Zuletzt geprüft: ${reference.version ? dateLong(reference.version) || reference.version : "nicht verfügbar"}.`}</p>
      : <p>Schick uns den Link zum Stipendium mit, damit wir den Eintrag finden.</p>}
    {stored && <p role="status">Danke. Wir prüfen dieses Stipendium noch einmal mit seiner offiziellen Quelle und korrigieren es, wenn nötig. Wenn die Quelle weiter mit unseren Angaben übereinstimmt, sieht sich ein Mensch deine Meldung an.</p>}
    {storable && !stored && <Form method="post" action={reportHref(reference!)} className="report-form">
      <input type="hidden" name="call" value={reference!.callId} />
      {reference!.version && <input type="hidden" name="version" value={reference!.version} />}
      <label htmlFor="report-reason">Was stimmt nicht?</label>{" "}
      <select id="report-reason" name="reason" value={reason} onChange={(event) => setReason(event.target.value as ReportReason)}>
        {Object.entries(REPORT_REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <label htmlFor="report-note">Was ist dir aufgefallen? <small>Freiwillig, bis zu {REPORT_NOTE_LIMIT} Zeichen. Kein Konto und keine E-Mail nötig; bitte keine persönlichen Angaben.</small></label>
      <textarea id="report-note" name="note" maxLength={REPORT_NOTE_LIMIT} rows={3} />
      <p className="fine">Gespeichert werden nur das Stipendium, die angezeigte Version, der Grund, deine Notiz und der Zeitpunkt. Wir löschen die Meldung 12 Monate nach ihrer Prüfung. <a href="/privacy">Mehr im Datenschutzhinweis</a></p>
      {failed && <p role="alert">{result?.outcome === "limited" ? "Zu diesem Stipendium gibt es heute schon viele Meldungen; wir kümmern uns darum." : "Wir konnten deine Meldung gerade nicht speichern. Du kannst sie unten per E-Mail schicken."}</p>}
      <button className="button" type="submit" disabled={busy}>{busy ? "Wird gesendet …" : "Meldung senden"}</button>
    </Form>}
    {!storable && <>
      <label htmlFor="report-reason">Was stimmt nicht?</label>{" "}
      <select id="report-reason" value={reason} onChange={(event) => setReason(event.target.value as ReportReason)}>
        {Object.entries(REPORT_REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </>}
    {(!storable || failed) && <>
      <p><a className="button" href={reportDraft(reference, reason)}>E-Mail-Meldung vorbereiten</a></p>
      <p>Das öffnet einen Entwurf in deinem E-Mail-Programm. Es wurde noch nichts gesendet oder empfangen. Prüf den Entwurf und schick ihn dort ab. Wenn sich kein E-Mail-Programm öffnet, schreib direkt an {SUPPORT_EMAIL}.</p>
      <p>Deine E-Mail-Adresse und was du schickst, sehen der Support und die E-Mail-Anbieter. Bitte keine Profilangaben, Lebensläufe oder sensiblen persönlichen Angaben.</p>
    </>}
    <p>Wir bestätigen Meldungen möglichst innerhalb von zwei Werktagen. Schau in der Zwischenzeit auf die offiziellen Angaben des Anbieters.</p>
    <p>Für Hilfe oder eine Datenschutzanfrage schreib an <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. <a href="/privacy">Mehr zu Datenschutz und Speicherdauer</a>.</p>
  </main>;
}
