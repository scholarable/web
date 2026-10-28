import { authkitLoader } from "@workos-inc/authkit-react-router";
import { useState } from "react";
import { data, Link, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/answer-library";
import { answerThemes, reuseWarnings, type AnswerTheme } from "../lib/answer-library";
import { sampleCallId, sampleTitle } from "../lib/account-sample";
import { dateTimeDe, outcomesDe, themeDe } from "../lib/copy-de";
import { requireSameOriginPost, requireStudentAuth, studentAuthEnv, studentConnection } from "../lib/student-auth.server";
import { clearStudentAnswerLibrary, deleteStudentLibraryAnswer, readStudentAnswerLibrary,
  readStudentProfileVault, setStudentLibraryArchive, updateStudentLibraryAnswer, updateStudentLibraryReflection } from "../lib/student-progress.server";

export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
export const meta = () => [{ title: "Antwortbibliothek | Scholarable" }];
type ActionResult = { error?: string; message?: string };

function CopyAnswer({ answer }: { answer: string }) {
  const [message, setMessage] = useState("");
  return <><button type="button" className="text-button" onClick={async () => {
    try { await navigator.clipboard.writeText(answer); setMessage("Kopiert."); }
    catch { setMessage("Kopieren hat nicht geklappt. Markier den Text der Antwort, um ihn zu kopieren."); }
  }}>Antwort kopieren</button><span role="status">{message}</span></>;
}

export async function loader(args: Route.LoaderArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context));
  return authkitLoader(args, async ({ auth, getAccessToken }) => {
    if (!auth.user.emailVerified || auth.impersonator) throw new Response("Verified student account required", { status: 403 });
    const { query, digest } = await studentConnection(args.context, auth.user.id, getAccessToken());
    const [library, vault] = await Promise.all([readStudentAnswerLibrary(query, digest), readStudentProfileVault(query, digest)]);
    return data({ library, vault });
  }, { ensureSignedIn: true });
}

export async function action(args: Route.ActionArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context));
  requireSameOriginPost(args.request);
  if (!args.request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) throw new Response("Form encoding required", { status: 415 });
  const body = await args.request.text();
  if (body.length > 32000) throw new Response("Form too large", { status: 413 });
  const form = new URLSearchParams(body);
  return authkitLoader(args, async ({ auth, getAccessToken }) => {
    if (!auth.user.emailVerified || auth.impersonator) throw new Response("Verified student account required", { status: 403 });
    const { query, digest } = await studentConnection(args.context, auth.user.id, getAccessToken());
    try {
      const item = form.get("itemId") || "";
      if (form.get("intent") === "edit") await updateStudentLibraryAnswer(query, digest, item,
        form.get("answer") || "", form.getAll("theme") as AnswerTheme[], form.getAll("profileId"), Number(form.get("version")));
      else if (form.get("intent") === "reflection") {
        const reflection: { interview_invitation?: boolean; feedback?: string; outcome?: "accepted" | "rejected" | "waitlisted" | "withdrawn"; lessons?: string } = {};
        if (form.get("interview") === "yes" || form.get("interview") === "no") reflection.interview_invitation = form.get("interview") === "yes";
        if (form.get("feedback")?.trim()) reflection.feedback = form.get("feedback")!.trim();
        if (form.get("lessons")?.trim()) reflection.lessons = form.get("lessons")!.trim();
        const outcome = form.get("outcome");
        if (outcome) reflection.outcome = outcome as typeof reflection.outcome;
        await updateStudentLibraryReflection(query, digest, item, reflection, Number(form.get("version")));
      }
      else if (form.get("intent") === "archive") await setStudentLibraryArchive(query, digest, item, form.get("archived") === "true");
      else if (form.get("intent") === "delete") {
        if (form.get("confirm") !== "DELETE") return data<ActionResult>({ error: "Gib DELETE ein, um diese Antwort zu löschen." }, { status: 400 });
        await deleteStudentLibraryAnswer(query, digest, item);
      } else if (form.get("intent") === "clear") {
        if (form.get("confirm") !== "DELETE ALL") return data<ActionResult>({ error: "Gib DELETE ALL ein, um deine Antwortbibliothek zu löschen." }, { status: 400 });
        await clearStudentAnswerLibrary(query, digest);
      } else return data<ActionResult>({ error: "Unbekannte Aktion." }, { status: 400 });
      return data<ActionResult>({ message: "Gespeichert." });
    } catch (error) {
      if (error instanceof Error && /changed; reload/i.test(error.message)) return data<ActionResult>({ error: "Diese Antwort hat sich in einem anderen Tab geändert. Lade die Seite neu, bevor du speicherst." }, { status: 409 });
      if (error instanceof Error && /Invalid|linked profile items|not found/i.test(error.message)) return data<ActionResult>({ error: "Prüf die Antwort und die verknüpften Angaben, bevor du speicherst." }, { status: 400 });
      return data<ActionResult>({ error: "Die Antwortbibliothek ließ sich gerade nicht speichern." }, { status: 503 });
    }
  }, { ensureSignedIn: true });
}

export default function AnswerLibrary() {
  const { library, vault } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const confirmed = vault.items.filter(item => item.confirmation_state === "confirmed");
  return <main className="page-wrap account-page"><p><Link to="/account">← Gemerkt</Link></p>
    <h1>Meine Antwortbibliothek</h1><p className="lede">Hier stehen nur Antworten, die du aus einem freigegebenen Bewerbungsentwurf ausdrücklich speicherst. Deine wiederverwendbaren Geschichten bleiben in <Link to="/profile">deinem privaten Profil</Link>.</p>
    {fetcher.data?.error && <p className="form-error" role="alert">{fetcher.data.error}</p>}
    {fetcher.data?.message && <p role="status">{fetcher.data.message}</p>}
    <p><Link reloadDocument to="/account/download">Alle Kontodaten herunterladen</Link>, auch diese Bibliothek mit allen Versionen.</p>
    {library.length === 0 ? <p>Noch keine gespeicherten Antworten. Gib eine Antwort in einem Arbeitsbereich frei und wähl dann „In der Antwortbibliothek speichern“.</p>
      : library.map(item => { const latest = item.history[0]; const warnings = reuseWarnings(item, vault.items); return <article className="result-card" key={item.id}>
        <h2>{item.question.prompt}</h2><p>{item.call_id === sampleCallId ? `${sampleTitle} · privat, erfunden` : item.programme_title} · Fassung {item.packet_version} · Version {latest.version} · {item.submitted ? "Genau diese Antwort ist in einer festgehaltenen Einreichung" : "In keiner festgehaltenen Einreichung"}{item.archived_at ? " · archiviert" : ""}</p>
        <p>{latest.answer}</p><CopyAnswer answer={latest.answer} />{warnings.map(warning => <p className="notice" key={warning}>{warning}</p>)}
        <p>Die ursprüngliche Frage und die Grenzen des Anbieters bleiben an dieser Antwort. Prüf die aktuellen Anforderungen, bevor du sie anpasst.</p>
        <details><summary>Anpassen und als neue Version freigeben</summary><fetcher.Form key={`${item.id}-${latest.version}`} method="post"><input type="hidden" name="intent" value="edit" /><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="version" value={latest.version} />
          <label>Antwort<textarea name="answer" defaultValue={latest.answer} maxLength={20000} rows={8} required /></label>
          <fieldset><legend>Wiederverwendbare Themen</legend>{answerThemes.map(theme => <label key={theme}><input type="checkbox" name="theme" value={theme} defaultChecked={latest.themes.includes(theme)} />{themeDe(theme)}</label>)}</fieldset>
          <fieldset><legend>Verwendete bestätigte Angaben und Geschichten</legend>{confirmed.map(profile => <label key={profile.id}><input type="checkbox" name="profileId" value={profile.id} defaultChecked={latest.profile_links.some(link => link.item_id === profile.id)} />{profile.title}</label>)}</fieldset>
          <button disabled={busy}>Neue Version freigeben</button></fetcher.Form></details>
        <details><summary>Frühere Versionen</summary><ol>{item.history.map(version => <li key={version.version}><strong>Version {version.version}</strong> · {dateTimeDe(version.approved_at)}<p>{version.answer}</p></li>)}</ol></details>
        <details><summary>Auswahlgespräch, Ergebnis und Erkenntnisse</summary><p>Das sind deine eigenen Notizen. Ein Ergebnis beweist nicht, dass eine Antwort gut oder schlecht war.</p>
          <fetcher.Form key={`${item.id}-reflection-${item.reflection_version}`} method="post"><input type="hidden" name="intent" value="reflection" /><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="version" value={item.reflection_version} />
            <label>Einladung zum Auswahlgespräch<select name="interview" defaultValue={item.reflection.interview_invitation === undefined ? "" : item.reflection.interview_invitation ? "yes" : "no"}><option value="">Nicht eingetragen</option><option value="yes">Ja</option><option value="no">Nein</option></select></label>
            <label>Mein Ergebnis<select name="outcome" defaultValue={item.reflection.outcome || ""}><option value="">Nicht eingetragen</option>{outcomesDe.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Rückmeldung<textarea name="feedback" defaultValue={item.reflection.feedback || ""} maxLength={2000} rows={3} /></label>
            <label>Erkenntnisse<textarea name="lessons" defaultValue={item.reflection.lessons || ""} maxLength={2000} rows={3} /></label>
            <button disabled={busy}>Notizen speichern</button></fetcher.Form></details>
        <fetcher.Form method="post" className="inline-form"><input type="hidden" name="intent" value="archive" /><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="archived" value={item.archived_at ? "false" : "true"} /><button className="text-button" disabled={busy}>{item.archived_at ? "Wiederherstellen" : "Archivieren"}</button></fetcher.Form>
        <p><Link reloadDocument to={`/account/library/download/${item.id}`}>Diese Antwort herunterladen</Link></p>
        <fetcher.Form method="post" className="inline-form"><input type="hidden" name="intent" value="delete" /><input type="hidden" name="itemId" value={item.id} /><label>Gib DELETE ein <input name="confirm" autoComplete="off" /></label><button className="text-button" disabled={busy}>Antwort löschen</button></fetcher.Form>
      </article>; })}
    {library.length > 0 && <section className="account-controls"><h2>Antwortbibliothek löschen</h2><p>Das löscht dauerhaft jede gespeicherte Antwort mit allen Versionen. Festgehaltene Einreichungen bleiben in ihren Arbeitsbereichen.</p>
      <fetcher.Form method="post" className="inline-form"><input type="hidden" name="intent" value="clear" /><label>Gib DELETE ALL ein <input name="confirm" autoComplete="off" /></label><button disabled={busy}>Alle Antworten löschen</button></fetcher.Form></section>}
  </main>;
}
