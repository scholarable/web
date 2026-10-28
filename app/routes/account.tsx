import { studentAuthLoader as authkitLoader } from "../lib/student-auth.server";
import { data, Form, Link, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/account";
import { useEffect, useState } from "react";
import { sampleAccountAllowed, sampleCallId, sampleSaved, sampleTitle, setSampleSaved } from "../lib/account-sample";
import { bonnPreviewSaved, bonnPreviewTitle, setBonnPreviewSaved } from "../lib/account-bonn-preview";
import { readMatchingCalls } from "../lib/matches.server";
import { publicDetails } from "../lib/public-details";
import { deadlineWatch, todayInBerlin } from "../lib/deadline-watch";
import { DeadlineWatch } from "../components/deadline-watch";
import { dateLong, inDays, outcomesDe as outcomes, stagesDe as stages } from "../lib/copy-de";
import { remindersReady, type ReminderEnv } from "../lib/email-reminders.server";
import { documentEnv } from "../lib/student-documents.server";
import { emailReady, sendWelcomeEmail, type EmailEnv } from "../lib/email.server";
import { principalFromVerifiedSession, requireSameOriginPost, requireStudentAuth, studentAuthEnv, studentConnection } from "../lib/student-auth.server";
import {
  deleteStudentAccount, deleteStudentApplication, readStudentProgress,
  setStudentApplicationOutcome, setStudentApplicationState, setStudentOpportunity,
  setStudentRecommendationEmailConsent, setStudentReminderConsent,
  type StudentOutcome,
} from "../lib/student-progress.server";
import { clearSignupFlowCookie, validSignupFlow, writeDiscoveryEvent, type DiscoveryAnalyticsEnv } from "../lib/discovery-analytics.server";

export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
export const meta = () => [{ title: "Gemerkt | Scholarable" }];
type AccountActionResult = { message?: string; error?: string };

export async function loader(args: Route.LoaderArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context));
  return authkitLoader(args, async ({ auth, getAccessToken }) => {
    if (!auth.user.emailVerified || auth.impersonator) throw new Response("Verified student account required", { status: 403 });
    const completedSignup = await validSignupFlow(args.request, studentAuthEnv(args.context)!.WORKOS_COOKIE_PASSWORD!);
    if (completedSignup) {
      writeDiscoveryEvent(studentAuthEnv(args.context) as DiscoveryAnalyticsEnv, { event: "signup_completed" });
    }
    const { query, digest } = await studentConnection(args.context, auth.user.id, getAccessToken());
    const progress = await readStudentProgress(query, digest);
    let calls: { id: string; title: string; slug: string; dates: ReturnType<typeof deadlineWatch> }[] = [];
    const today = todayInBerlin();
    try { calls = (await readMatchingCalls(studentAuthEnv(args.context))).map(({ id, title, slug, details }) => ({ id: String(id), title, slug, dates: deadlineWatch(publicDetails(details), today) })); }
    catch { /* Saved history remains visible when the public catalogue is unavailable. */ }
    const candidate = new URL(args.request.url).searchParams.get("save");
    return data({ progress, calls, sampleEnabled: sampleAccountAllowed(auth.user.email, studentAuthEnv(args.context)?.SCHOLARABLE_TEST_ACCOUNT_EMAIL),
      remindersAvailable: remindersReady(studentAuthEnv(args.context) as ReminderEnv),
      recommendationEmailsAvailable: emailReady(studentAuthEnv(args.context) as EmailEnv),
      documentsEnabled: documentEnv(args.context).SCHOLARABLE_DOCUMENTS_ENABLED === "true",
      candidate: candidate && /^[1-9][0-9]{0,17}$/.test(candidate) ? candidate : null },
    completedSignup ? { headers: { "Set-Cookie": clearSignupFlowCookie() } } : undefined);
  }, { ensureSignedIn: true });
}

export async function action(args: Route.ActionArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context));
  requireSameOriginPost(args.request);
  if (!args.request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) {
    throw new Response("Form encoding required", { status: 415 });
  }
  const body = await args.request.text();
  if (body.length > 12000) throw new Response("Form too large", { status: 413 });
  const form = new URLSearchParams(body);
  return authkitLoader(args, async ({ auth, getAccessToken }) => {
    if (!auth.user.emailVerified || auth.impersonator) throw new Response("Verified student account required", { status: 403 });
    const { query, digest } = await studentConnection(args.context, auth.user.id, getAccessToken());
    const intent = form.get("intent");
    if (["save", "remove", "stage", "clear-stage", "outcome"].includes(intent || "") && form.get("callId") === sampleCallId)
      return data<AccountActionResult>({ error: "Nutz für diese erfundene Bewerbung den privaten Übungsbereich." }, { status: 400 });
    try {
      if (intent === "save") {
        await setStudentOpportunity(query, digest, form.get("callId") || "", "saved");
      } else if (intent === "remove") {
        await setStudentOpportunity(query, digest, form.get("callId") || "", "dismissed");
      } else if (intent === "stage") {
        const state = form.get("state");
        if (!state || !["planned", "preparing", "submitted", "interview", "decision", "completed"].includes(state)) {
          return data<AccountActionResult>({ error: "Wähl einen gültigen Stand." }, { status: 400 });
        }
        await setStudentApplicationState(query, digest, form.get("callId") || "", state as "planned");
      } else if (intent === "clear-stage") {
        await deleteStudentApplication(query, digest, form.get("callId") || "");
      } else if (intent === "outcome") {
        const outcome = form.get("outcome") || null;
        if (outcome !== null && !["accepted", "rejected", "waitlisted", "withdrawn"].includes(outcome)) {
          return data<AccountActionResult>({ error: "Wähl ein gültiges Ergebnis." }, { status: 400 });
        }
        await setStudentApplicationOutcome(query, digest, form.get("callId") || "", outcome as StudentOutcome | null);
      } else if (intent === "recommendations") {
        const env = studentAuthEnv(args.context) as EmailEnv;
        const enabled = form.get("enabled");
        if (enabled !== "yes" && enabled !== "no") return data<AccountActionResult>({ error: "Wähl eine E-Mail-Einstellung." }, { status: 400 });
        if (enabled === "yes" && !emailReady(env)) return data<AccountActionResult>({ error: "Stipendien-E-Mails gibt es noch nicht." }, { status: 503 });
        await setStudentRecommendationEmailConsent(query, digest, enabled === "yes", "recommendations-2026-09-26");
        if (enabled === "yes") {
          try { await sendWelcomeEmail(env, digest, auth.user.email); }
          catch { return data<AccountActionResult>({ message: "Stipendien-E-Mails sind an. Die Willkommens-E-Mail konnte nicht zugestellt werden." }); }
        }
      } else if (intent === "reminders") {
        const env = studentAuthEnv(args.context) as ReminderEnv;
        const enabled = form.get("enabled");
        if (enabled !== "yes" && enabled !== "no") return data<AccountActionResult>({ error: "Wähl eine Erinnerungs-Einstellung." }, { status: 400 });
        if (enabled === "yes" && (!remindersReady(env) ||
          principalFromVerifiedSession(getAccessToken(), auth.user.id, env.WORKOS_CLIENT_ID!).issuer !== env.SCHOLARABLE_REMINDER_ISSUER)) {
          return data<AccountActionResult>({ error: "E-Mail-Erinnerungen gibt es noch nicht." }, { status: 503 });
        }
        await setStudentReminderConsent(query, digest, enabled === "yes", "reminders-2026-09-20");
      } else if (intent === "delete-data") {
        if (form.get("confirm") !== "DELETE") return data<AccountActionResult>({ error: "Gib zur Bestätigung DELETE ein." }, { status: 400 });
        await deleteStudentAccount(query, digest);
      } else {
        return data<AccountActionResult>({ error: "Unbekannte Aktion." }, { status: 400 });
      }
      return data<AccountActionResult>({ message: intent === "delete-data" ? "Gespeicherte Daten gelöscht." : "Gespeichert." });
    } catch (error) {
      const invalid = error instanceof Error && ["Invalid profile", "Invalid opportunity", "Invalid profile item"].includes(error.message);
      return data<AccountActionResult>({ error: invalid ? "Bitte prüf die Angaben und versuch es noch einmal." : "Gerade konnten wir nicht speichern. Deine Änderung ist nicht übernommen. Versuch es später noch einmal." }, { status: invalid ? 400 : 503 });
    }
  }, { ensureSignedIn: true });
}

// "Gemerkt": everything a signed-in student saved, in one place: the next
// dates, each scholarship with its own stage and result, and the controls.
export default function Account() {
  const { user, progress, calls, candidate, remindersAvailable, recommendationEmailsAvailable, sampleEnabled, documentsEnabled } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [deleteText, setDeleteText] = useState("");
  const [sampleIsSaved, setSampleIsSaved] = useState(false);
  const [sampleStorageError, setSampleStorageError] = useState(false);
  const [bonnIsSaved, setBonnIsSaved] = useState(false);
  const [bonnStorageError, setBonnStorageError] = useState(false);
  useEffect(() => { if (sampleEnabled) setSampleIsSaved(sampleSaved(window.localStorage)); }, [sampleEnabled]);
  useEffect(() => { if (sampleEnabled) setBonnIsSaved(bonnPreviewSaved(window.localStorage)); }, [sampleEnabled]);
  const changeSample = (saved: boolean) => {
    try { setSampleSaved(window.localStorage, saved); setSampleIsSaved(saved); setSampleStorageError(false); }
    catch { setSampleStorageError(true); }
  };
  const changeBonnPreview = (saved: boolean) => {
    try { setBonnPreviewSaved(window.localStorage, saved); setBonnIsSaved(saved); setBonnStorageError(false); }
    catch { setBonnStorageError(true); }
  };
  const busy = fetcher.state !== "idle";
  const call = (id: string) => calls.find((item) => item.id === id);
  const candidateCall = candidate ? call(candidate) : undefined;
  const saved = progress.opportunities.filter((item) => item.disposition === "saved" && (!sampleEnabled || String(item.call_id) !== sampleCallId));
  const dates = saved.flatMap(item => { const entry = call(String(item.call_id)); return entry?.dates.map(date => ({ callId: entry.id, title: entry.title, slug: entry.slug, date })) || []; })
    .sort((a, b) => a.date.date.localeCompare(b.date.date)).slice(0, 10);
  return <main className="mine">
    <div className="mine-head"><p className="quiet-line">Angemeldet als {user.email} · nur du siehst diese Seite</p><h1>Gemerkt</h1>
      <p className="lede">Deine gemerkten Stipendien, dein Stand und deine Ergebnisse gehören nur zu diesem Konto. Scholarable bewirbt sich nicht für dich und bestätigt keine Entscheidung eines Anbieters.</p></div>
    <div className="mine-main">
      {typeof fetcher.data?.error === "string" && <p className="form-error" role="alert">{fetcher.data.error}</p>}
      {typeof fetcher.data?.message === "string" && <p className="notice" role="status">{fetcher.data.message}</p>}
      {candidateCall && !saved.some(item => String(item.call_id) === candidate) && <section className="notice"><h2>Dieses Stipendium merken?</h2><p>{candidateCall.title}</p>
        <fetcher.Form method="post"><input type="hidden" name="intent" value="save" /><input type="hidden" name="callId" value={candidate || ""} /><button className="btn dark" disabled={busy}>Merken</button></fetcher.Form>
        <p className="fine">Dein Profil ist freiwillig; Angaben zum Studium kannst du später ergänzen.</p>
      </section>}
      {saved.length > 0 && <DeadlineWatch items={dates} />}
      <section className="saved" aria-labelledby="saved-h"><h2 id="saved-h">Deine Stipendien ({saved.length})</h2>
        {saved.length === 0 ? <p className="empty">Noch nichts gemerkt. <Link to="/">Finde passende Stipendien</Link> und tipp auf das Lesezeichen.</p>
          : saved.map((item) => { const id = String(item.call_id); const detail = call(id); const application = progress.applications.find((entry) => String(entry.call_id) === id); const outcome = progress.outcomes.find((entry) => String(entry.call_id) === id);
            const nextDate = detail?.dates[0];
            return <article className="scard" key={id}><h3>{detail?.title || `Stipendium ${id}`}</h3>
              {!item.currently_available && <p className="notice">Nicht mehr in der geprüften Liste. Prüf beim Anbieter, bevor du etwas tust.</p>}
              {nextDate && <p className="when"><span className={`pill ${nextDate.daysAway <= 14 ? "urgent" : "open"}`}>Frist {dateLong(nextDate.date)}</span><span>{inDays(nextDate.daysAway)}</span></p>}
              <div className="scard-row">{detail && <Link className="btn link" to={`/scholarships/${encodeURIComponent(detail.slug)}`}>Ansehen</Link>}
                <Link className="btn link" to={`/account/applications/${encodeURIComponent(id)}`}>Bewerbung vorbereiten</Link></div>
              <fetcher.Form method="post" className="inline-form"><input type="hidden" name="intent" value="stage" /><input type="hidden" name="callId" value={id} />
                <label>Mein Stand <select name="state" defaultValue={application?.state || "planned"}>{stages.map(([state, label]) => <option key={state} value={state}>{label}</option>)}</select></label>
                <button className="btn line sm" disabled={busy}>Stand speichern</button></fetcher.Form>
              {application && <fetcher.Form method="post" className="inline-form"><input type="hidden" name="intent" value="clear-stage" /><input type="hidden" name="callId" value={id} /><button className="btn link" disabled={busy}>Stand löschen</button></fetcher.Form>}
              <fetcher.Form key={`${id}-${outcome?.outcome || "none"}`} method="post" className="inline-form"><input type="hidden" name="intent" value="outcome" /><input type="hidden" name="callId" value={id} />
                <label>Mein Ergebnis <select name="outcome" defaultValue={outcome?.outcome || ""}><option value="">Noch nichts</option>{outcomes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <button className="btn line sm" disabled={busy}>Ergebnis speichern</button></fetcher.Form>
              <p className="fine">Dein eigener Stand. Nicht vom Anbieter bestätigt und nicht öffentlich.</p>
              <fetcher.Form method="post" className="inline-form"><input type="hidden" name="intent" value="remove" /><input type="hidden" name="callId" value={id} /><button className="btn link quiet" disabled={busy}>Entfernen</button></fetcher.Form>
            </article>; })}
        {sampleEnabled && <article className="scard"><p className="kicker">Nur zum Testen · erfunden</p><h3>{sampleTitle}</h3>
          <p>Dieses Beispiel erscheint nie in der öffentlichen Liste oder im Abgleich und wird nicht in deinem Konto gespeichert. Nur ein Merkzeichen bleibt in diesem Browser.</p>
          {sampleStorageError && <p className="form-error" role="alert">Dieser Browser konnte das Übungs-Merkzeichen nicht speichern.</p>}
          {sampleIsSaved ? <><p><Link className="btn link" to="/account/practice-scholarship">Übungsbereich öffnen</Link></p>
            <button className="btn link quiet" type="button" onClick={() => changeSample(false)}>Beispiel entfernen</button></>
            : <button className="btn dark sm" type="button" onClick={() => changeSample(true)}>Übungs-Stipendium merken</button>}
        </article>}
        {sampleEnabled && <article className="scard"><p className="kicker">Nur zum Testen · erfunden</p><h3>Den ganzen Ablauf zum Speichern von Antworten testen</h3>
          <p>Nur dieses Testkonto kann ihn öffnen. Die erfundene Bewerbung und die Antworten werden privat gespeichert, erscheinen nie öffentlich und können nicht eingereicht werden. Nutz nur erfundene Angaben.</p>
          <Link className="btn link" to={`/account/applications/${sampleCallId}`}>Gespeicherte Übungsbewerbung öffnen</Link>
        </article>}
        {sampleEnabled && <article className="scard"><p className="kicker">Nur zum Testen · echter Anbieter</p><h3>{bonnPreviewTitle}</h3>
          <p>Anbieterseiten geprüft am 27. September 2026: Bonn nennt zwei Fristen für 2027, sagt aber, dass die Bewerbung im Herbst öffnet. Nicht in der öffentlichen Liste und nicht in deinem Konto gespeichert; nur ein Merkzeichen bleibt in diesem Browser.</p>
          {bonnStorageError && <p className="form-error" role="alert">Dieser Browser konnte das Merkzeichen nicht speichern.</p>}
          {bonnIsSaved ? <><p><Link className="btn link" to="/account/bonn-preview">Private Planungsvorschau öffnen</Link></p>
            <button className="btn link quiet" type="button" onClick={() => changeBonnPreview(false)}>Bonn-Vorschau entfernen</button></>
            : <button className="btn dark sm" type="button" onClick={() => changeBonnPreview(true)}>Bonn-Vorschau in diesem Browser merken</button>}
        </article>}
      </section>
    </div>
    <aside className="side">
      <section className="panel"><h2>Erinnerungen</h2>
        <p>{progress.email_reminders_enabled && !remindersAvailable ? "Der Versand ist pausiert. Deine Einstellung bleibt an, du kannst sie unten ausschalten." : remindersAvailable ? "Wir schicken dir 7 Tage und 1 Tag vor einer geprüften, allgemeinen Frist eine E-Mail. Fristen für bestimmte Gruppen prüfst du selbst." : "E-Mail-Erinnerungen gibt es noch nicht; es werden keine E-Mails verschickt."} Prüf vor der Bewerbung immer die aktuellen Angaben des Anbieters.</p>
        {(remindersAvailable || progress.email_reminders_enabled) && <fetcher.Form method="post" className="inline-form"><input type="hidden" name="intent" value="reminders" />
          <input type="hidden" name="enabled" value={progress.email_reminders_enabled ? "no" : "yes"} />
          <button className={progress.email_reminders_enabled ? "btn link" : "btn dark sm"} disabled={busy}>{progress.email_reminders_enabled ? "Erinnerungen ausschalten" : "Erinnerungen einschalten"}</button>
          <span role="status">{progress.email_reminders_enabled ? "An" : "Aus"}</span>
        </fetcher.Form>}
      </section>
      <section className="panel"><h2>Stipendien-E-Mails</h2>
        <p>{progress.recommendation_emails_enabled ? "Persönliche Stipendien-E-Mails sind an. Du kannst sie jederzeit ausschalten." : recommendationEmailsAvailable ? "Schalte sie ein, um passende Stipendien per E-Mail zu bekommen. Kein allgemeiner Newsletter; der Versand startet erst, wenn der Abgleich dafür fertig ist." : "Persönliche Stipendien-E-Mails gibt es noch nicht; es werden keine verschickt."}</p>
        {(recommendationEmailsAvailable || progress.recommendation_emails_enabled) && <fetcher.Form method="post" className="inline-form"><input type="hidden" name="intent" value="recommendations" />
          <input type="hidden" name="enabled" value={progress.recommendation_emails_enabled ? "no" : "yes"} />
          <button className={progress.recommendation_emails_enabled ? "btn link" : "btn dark sm"} disabled={busy}>{progress.recommendation_emails_enabled ? "E-Mails ausschalten" : "E-Mails einschalten"}</button>
          <span role="status">{progress.recommendation_emails_enabled ? "An" : "Aus"}</span>
        </fetcher.Form>}
      </section>
      <section className="panel"><h2>Dein Material</h2>
        <p>Studium, Nachweise und Geschichten, die du für Bewerbungen wiederverwenden kannst.</p>
        <Link className="btn line sm" to="/profile">Profil öffnen</Link>
        <Link className="btn link" to="/account/library">Antwortbibliothek</Link>
        {documentsEnabled && <Link className="btn link" to="/account/documents">Meine Dokumente</Link>}
      </section>
      <section className="panel account-controls"><h2>Konto</h2>
        <Form method="post" action="/auth/sign-out"><button className="btn link" disabled={busy}>Abmelden</button></Form>
        <form method="get" action="/account/download"><button className="btn link" disabled={busy}>Meine Daten herunterladen</button></form>
        <p className="fine">Löscht dein gespeichertes Scholarable-Profil, Nachweise, gemerkte Stipendien und deinen Stand, auch die Bewerbungs-Schnappschüsse. Deine Anmeldung bei WorkOS bleibt; dafür schreib dem Support.</p>
        <fetcher.Form method="post" className="inline-form"><input type="hidden" name="intent" value="delete-data" />
          <label>Gib DELETE ein, um zu bestätigen <input name="confirm" value={deleteText} onChange={(event) => setDeleteText(event.target.value)} autoComplete="off" /></label>
          <button className="btn line sm" disabled={busy || deleteText !== "DELETE"}>Gespeicherte Daten löschen</button></fetcher.Form>
      </section>
    </aside>
  </main>;
}
