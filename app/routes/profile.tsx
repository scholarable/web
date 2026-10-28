import { studentAuthLoader as authkitLoader } from "../lib/student-auth.server";
import { useEffect, useState } from "react";
import { data, Link, useFetcher, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/profile";
import { clearSignupFlowCookie, validSignupFlow, writeDiscoveryEvent, type DiscoveryAnalyticsEnv } from "../lib/discovery-analytics.server";
import { contextStorageKey, readDiscoveryContext, type DiscoveryContext } from "../lib/discovery-context";
import { profileKindDetails, profileKinds, profileReadiness, profileSourceLabel } from "../lib/profile-experience";
import { type ProfileItem, type ProfileItemKind } from "../lib/profile-vault";
import { requireSameOriginPost, requireStudentAuth, studentAuthEnv, studentConnection } from "../lib/student-auth.server";
import {
  createStudentProfileItem, deleteStudentAccount, deleteStudentProfileItem, readStudentProfileVault,
  readStudentProgress, saveDiscoveryContext, saveStudentProfile, setStudentProfileItemConfirmation, updateStudentProfileItem,
} from "../lib/student-progress.server";

export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
export const meta = () => [{ title: "Mein Profil | Scholarable" }];
type ProfileActionResult = { message?: string; error?: string };
// AuthKit re-wraps action data without its status, so failed writes arrive as 200.
// Nothing changed; skip reloading so a database outage keeps the retry message.
export const shouldRevalidate = ({ actionResult, defaultShouldRevalidate }: { actionResult?: unknown; defaultShouldRevalidate: boolean }) =>
  (actionResult as ProfileActionResult | undefined)?.error ? false : defaultShouldRevalidate;

export async function loader(args: Route.LoaderArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context));
  return authkitLoader(args, async ({ auth, getAccessToken }) => {
    if (!auth.user.emailVerified || auth.impersonator) throw new Response("Verified student account required", { status: 403 });
    const { query, digest } = await studentConnection(args.context, auth.user.id, getAccessToken());
    const [progress, vault] = await Promise.all([readStudentProgress(query, digest), readStudentProfileVault(query, digest)]);
    const completedSignup = await validSignupFlow(args.request, studentAuthEnv(args.context)!.WORKOS_COOKIE_PASSWORD!);
    if (completedSignup) writeDiscoveryEvent(studentAuthEnv(args.context) as DiscoveryAnalyticsEnv, { event: "signup_completed" });
    return data({ progress, vault }, completedSignup ? { headers: { "Set-Cookie": clearSignupFlowCookie() } } : undefined);
  }, { ensureSignedIn: true });
}

function fact(value: string, withheld = false) {
  if (withheld) return { value: null, value_state: "prefer_not_to_say" as const, confirmation_state: "confirmed" as const };
  const clean = value.trim();
  return { value: clean || null, value_state: clean ? "known" as const : "unknown" as const, confirmation_state: "confirmed" as const };
}

function itemContent(form: URLSearchParams) {
  return {
    kind: form.get("kind") || "", title: form.get("title") || "", organisation: form.get("organisation") || "",
    role: form.get("role") || "", summary: form.get("summary") || "", outcome: form.get("outcome") || "",
    situation: form.get("situation") || "", actions: form.get("actions") || "", result: form.get("result") || "",
    reflection: form.get("reflection") || "", start_date: form.get("start_date") || "", end_date: form.get("end_date") || "",
    tags: (form.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean),
  };
}

export async function action(args: Route.ActionArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context));
  requireSameOriginPost(args.request);
  if (!args.request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) {
    throw new Response("Form encoding required", { status: 415 });
  }
  const body = await args.request.text();
  if (body.length > 64000) throw new Response("Form too large", { status: 413 });
  const form = new URLSearchParams(body);
  return authkitLoader(args, async ({ auth, getAccessToken }) => {
    if (!auth.user.emailVerified || auth.impersonator) throw new Response("Verified student account required", { status: 403 });
    const intent = form.get("intent");
    try {
      // Inside the try: an unavailable database must return a retryable error, not replace the page.
      const { query, digest } = await studentConnection(args.context, auth.user.id, getAccessToken());
      if (intent === "discovery-context") {
        await saveDiscoveryContext(query, digest, JSON.parse(form.get("context") || "null"));
      } else if (intent === "matching-profile") {
        if (form.get("adult") !== "yes") return data<ProfileActionResult>({ error: "Bestätige, dass du mindestens 18 bist." }, { status: 400 });
        const semester = form.get("semester") || "";
        await saveStudentProfile(query, digest, { facts: {
          adult_confirmation: { value: true, value_state: "known", confirmation_state: "confirmed" },
          institution: form.get("institution_state") === "prefer_not_to_say" ? fact("", true)
            : form.get("institution_state") === "known" ? fact(form.get("institution") || "") : fact(""),
          degree_level: fact(form.get("degree") || "", form.get("degree") === "prefer_not_to_say"),
          subject: form.get("subject_state") === "prefer_not_to_say" ? fact("", true)
            : form.get("subject_state") === "known" ? fact(form.get("subject") || "") : fact(""),
          semester_number: semester === "prefer_not_to_say" ? fact("", true) : semester
            ? { value: Number(semester), value_state: "known", confirmation_state: "confirmed" } : fact(""),
          milestone: fact(form.get("plan") || "", form.get("plan") === "prefer_not_to_say"),
        } });
      } else if (intent === "item-create") {
        await createStudentProfileItem(query, digest, itemContent(form));
      } else if (intent === "item-update") {
        if (!await updateStudentProfileItem(query, digest, form.get("itemId") || "", itemContent(form))) {
          return data<ProfileActionResult>({ error: "Diesen Eintrag gibt es nicht mehr." }, { status: 404 });
        }
      } else if (intent === "item-confirm" || intent === "item-reject") {
        if (!await setStudentProfileItemConfirmation(query, digest, form.get("itemId") || "", intent === "item-confirm" ? "confirmed" : "rejected")) {
          return data<ProfileActionResult>({ error: "Diesen Eintrag gibt es nicht mehr." }, { status: 404 });
        }
      } else if (intent === "item-delete") {
        if (!await deleteStudentProfileItem(query, digest, form.get("itemId") || "")) {
          return data<ProfileActionResult>({ error: "Diesen Eintrag gibt es nicht mehr." }, { status: 404 });
        }
      } else if (intent === "delete-data") {
        if (form.get("confirm") !== "DELETE") return data<ProfileActionResult>({ error: "Gib zur Bestätigung DELETE ein." }, { status: 400 });
        await deleteStudentAccount(query, digest);
      } else {
        return data<ProfileActionResult>({ error: "Unbekannte Aktion." }, { status: 400 });
      }
      return data<ProfileActionResult>({ message: intent === "delete-data" ? "Gespeicherte Daten gelöscht." : "Gespeichert." });
    } catch (error) {
      if (error instanceof Response) throw error;
      const invalid = error instanceof Error && ["Invalid profile", "Invalid profile item"].includes(error.message) || error instanceof SyntaxError;
      return data<ProfileActionResult>({ error: invalid ? "Bitte prüf die Angaben und versuch es noch einmal." : "Gerade konnten wir nicht speichern. Deine Änderung ist nicht übernommen. Versuch es später noch einmal." }, { status: invalid ? 400 : 503 });
    }
  }, { ensureSignedIn: true });
}

const value = (entry: { value: unknown } | undefined) => typeof entry?.value === "string" || typeof entry?.value === "number" ? String(entry.value) : "";
const selected = (entry: { value: unknown; value_state: string } | undefined) => entry?.value_state === "prefer_not_to_say" ? "prefer_not_to_say" : value(entry);
const tagsValue = (item: ProfileItem) => item.tags?.join(", ") || "";
const stateWords: Record<string, string> = { candidate: "Zu prüfen", confirmed: "Bestätigt", rejected: "Abgelehnt" };
const fieldWords: Record<string, string> = { adult_confirmation: "18 oder älter", institution: "Hochschule", degree_level: "Studium", subject: "Fach", semester_number: "Fachsemester", milestone: "Vorhaben" };
const valueWords: Record<string, string> = { bachelor: "Bachelor", master: "Master", doctoral: "Promotion", exchange: "Auslandsaufenthalt", internship: "Praktikum", thesis: "Abschlussarbeit", graduation: "Abschluss", unknown: "weiß ich nicht", prefer_not_to_say: "möchte ich nicht sagen", not_applicable: "trifft nicht zu" };
const factWords = (fact: { value: unknown; value_state: string }) => fact.value === true ? "ja" : valueWords[String(fact.value ?? fact.value_state)] || String(fact.value ?? fact.value_state);

function ItemFields({ item, kind }: { item?: ProfileItem; kind?: ProfileItemKind }) {
  return <>
    <label><span>Titel</span><input name="title" maxLength={200} required defaultValue={item?.title} /></label>
    <div className="vault-fields">
      <label><span>Organisation, Einrichtung oder Aussteller <small>Freiwillig</small></span><input name="organisation" maxLength={2000} defaultValue={item?.organisation} /></label>
      <label><span>Deine Rolle <small>Freiwillig</small></span><input name="role" maxLength={2000} defaultValue={item?.role} /></label>
      <label><span>Beginn <small>Freiwillig</small></span><input type="date" name="start_date" defaultValue={item?.start_date} /></label>
      <label><span>Ende <small>Freiwillig</small></span><input type="date" name="end_date" defaultValue={item?.end_date} /></label>
    </div>
    <label><span>Was passiert ist oder warum es zählt <small>Freiwillig</small></span><textarea name="summary" maxLength={2000} rows={4} defaultValue={item?.summary} /></label>
    <label><span>Ergebnis oder Wirkung <small>Freiwillig</small></span><textarea name="outcome" maxLength={2000} rows={3} defaultValue={item?.outcome} /></label>
    <details className="vault-story-fields" open={(item?.kind || kind) === "story" || undefined}><summary>Als wiederverwendbare Geschichte aufschreiben (freiwillig)</summary>
      <label><span>Situation</span><textarea name="situation" maxLength={2000} rows={3} defaultValue={item?.situation} /></label>
      <label><span>Was du getan hast</span><textarea name="actions" maxLength={2000} rows={3} defaultValue={item?.actions} /></label>
      <label><span>Ergebnis</span><textarea name="result" maxLength={2000} rows={3} defaultValue={item?.result} /></label>
      <label><span>Rückblick</span><textarea name="reflection" maxLength={2000} rows={3} defaultValue={item?.reflection} /></label>
    </details>
    <label><span>Fähigkeiten oder Themen, mit Kommas getrennt <small>Freiwillig</small></span><input name="tags" maxLength={1219} defaultValue={item ? tagsValue(item) : undefined} /></label>
  </>;
}

function ProfileItemCard({ item, busy }: { item: ProfileItem; busy: boolean }) {
  const fetcher = useFetcher<typeof action>();
  const details = profileKindDetails[item.kind];
  return <article className={`vault-card ${item.has_conflict || item.has_duplicate ? "has-conflict" : ""}`}>
    <div className="vault-card-heading"><div><p className="step-label">{details.label}</p><h3>{item.title}</h3></div>
      <span className={`status vault-status ${item.confirmation_state}`}>{stateWords[item.confirmation_state] || item.confirmation_state}</span></div>
    {typeof fetcher.data?.error === "string" && <p className="form-error" role="alert">{fetcher.data.error}</p>}
    {typeof fetcher.data?.message === "string" && <p role="status">{fetcher.data.message}</p>}
    <p className="guide-meta">{profileSourceLabel(item)} <span aria-hidden="true">·</span> Version {item.version}</p>
    {item.confirmation_state === "candidate" && <p className="candidate-note">Dieser übernommene Vorschlag zählt für Abgleich und Bewerbungen erst, wenn du ihn bestätigst.</p>}
    {item.has_conflict && <p className="vault-conflict" role="status">Möglicher Widerspruch: Ein anderer aktueller Eintrag unter „{details.label}“ hat diesen Titel, aber andere Angaben. Prüf beide; Scholarable hat sie nicht zusammengeführt.</p>}
    {item.has_duplicate && <p className="vault-conflict" role="status">Mögliche Doppelung: Ein anderer aktueller Eintrag hat dieselben Angaben. Prüf beide und lösch die Kopie, die du nicht brauchst. Scholarable hat sie nicht zusammengeführt.</p>}
    {item.organisation && <p><strong>{item.organisation}</strong>{item.role ? ` — ${item.role}` : ""}</p>}
    {(item.start_date || item.end_date) && <p>{item.start_date || "Beginn unbekannt"} bis {item.end_date || "heute"}</p>}
    {item.summary && <p>{item.summary}</p>}
    {item.outcome && <p><strong>Ergebnis:</strong> {item.outcome}</p>}
    {(item.situation || item.actions || item.result || item.reflection) && <dl className="vault-story">
      {item.situation && <div><dt>Situation</dt><dd>{item.situation}</dd></div>}
      {item.actions && <div><dt>Was du getan hast</dt><dd>{item.actions}</dd></div>}
      {item.result && <div><dt>Ergebnis</dt><dd>{item.result}</dd></div>}
      {item.reflection && <div><dt>Rückblick</dt><dd>{item.reflection}</dd></div>}
    </dl>}
    {item.tags?.length ? <p className="guide-meta">{item.tags.join(", ")}</p> : null}
    {(item.source_excerpt || item.provenance[0]?.source_ref) && <details><summary>Woher das kommt</summary>
      {item.provenance[0]?.source_ref && <p><strong>Quellverweis:</strong> {item.provenance[0].source_ref}</p>}
      {item.source_excerpt && <p><strong>Ausschnitt aus der Quelle:</strong> {item.source_excerpt}</p>}
    </details>}
    {item.confirmation_state === "candidate" && <div className="vault-actions">
      <fetcher.Form method="post"><input type="hidden" name="intent" value="item-confirm" /><input type="hidden" name="itemId" value={item.id} /><button disabled={busy || fetcher.state !== "idle"}>Eintrag bestätigen</button></fetcher.Form>
      <fetcher.Form method="post"><input type="hidden" name="intent" value="item-reject" /><input type="hidden" name="itemId" value={item.id} /><button className="text-button" disabled={busy || fetcher.state !== "idle"}>Vorschlag ablehnen</button></fetcher.Form>
    </div>}
    {item.confirmation_state === "rejected" && <fetcher.Form method="post" className="vault-actions"><input type="hidden" name="intent" value="item-confirm" /><input type="hidden" name="itemId" value={item.id} /><button disabled={busy || fetcher.state !== "idle"}>Doch bestätigen</button></fetcher.Form>}
    <details className="vault-edit"><summary>Bearbeiten oder Verlauf ansehen</summary>
      <fetcher.Form method="post" className="profile-form vault-form"><input type="hidden" name="intent" value="item-update" /><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="kind" value={item.kind} />
        <ItemFields item={item} /><button disabled={busy || fetcher.state !== "idle"}>{item.confirmation_state === "confirmed" ? "Neue Version speichern" : "Neue Version speichern und bestätigen"}</button>
      </fetcher.Form>
      <ol className="vault-history">{item.history.map((version) => <li key={version.version}>
        <strong>Version {version.version} · {stateWords[version.confirmation_state] || version.confirmation_state}</strong><span>Erfasst am {new Date(version.recorded_at).toLocaleDateString("de-DE")} · {profileSourceLabel(version)}</span>
        <dl><div><dt>Titel</dt><dd>{version.title}</dd></div>
          {version.organisation && <div><dt>Organisation</dt><dd>{version.organisation}</dd></div>}
          {version.role && <div><dt>Rolle</dt><dd>{version.role}</dd></div>}
          {(version.start_date || version.end_date) && <div><dt>Zeitraum</dt><dd>{version.start_date || "unbekannt"} bis {version.end_date || "heute"}</dd></div>}
          {version.summary && <div><dt>Beschreibung</dt><dd>{version.summary}</dd></div>}
          {version.outcome && <div><dt>Ergebnis oder Wirkung</dt><dd>{version.outcome}</dd></div>}
          {version.situation && <div><dt>Situation</dt><dd>{version.situation}</dd></div>}
          {version.actions && <div><dt>Was du getan hast</dt><dd>{version.actions}</dd></div>}
          {version.result && <div><dt>Ergebnis der Geschichte</dt><dd>{version.result}</dd></div>}
          {version.reflection && <div><dt>Rückblick</dt><dd>{version.reflection}</dd></div>}
          {version.tags?.length ? <div><dt>Fähigkeiten oder Themen</dt><dd>{version.tags.join(", ")}</dd></div> : null}
          <div><dt>Schutzbedarf</dt><dd>{version.sensitivity === "moderate" ? "erhöht" : "normal"}</dd></div>
        </dl>
        {(version.source_excerpt || version.provenance[0]?.source_ref) && <details><summary>Für diese Version gespeicherte Quelle</summary>
          {version.provenance[0]?.source_ref && <p>{version.provenance[0].source_ref}</p>}{version.source_excerpt && <p>{version.source_excerpt}</p>}
        </details>}
      </li>)}</ol>
    </details>
    <fetcher.Form method="post" className="vault-delete"><input type="hidden" name="intent" value="item-delete" /><input type="hidden" name="itemId" value={item.id} /><button className="text-button" disabled={busy || fetcher.state !== "idle"}>Eintrag löschen</button></fetcher.Form>
  </article>;
}

export default function Profile() {
  const { progress, vault } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [searchParams] = useSearchParams();
  const saveCall = searchParams.get("save");
  const [pendingContext, setPendingContext] = useState<DiscoveryContext | null>(null);
  const handoff = useFetcher<typeof action>();
  useEffect(() => { try { setPendingContext(readDiscoveryContext(window.sessionStorage)); } catch { /* Manual entry remains available if browser storage is blocked. */ } }, []);
  useEffect(() => {
    if (handoff.data?.message) { try { window.sessionStorage.removeItem(contextStorageKey); } catch { /* The confirmed context is already saved to the account. */ } setPendingContext(null); }
  }, [handoff.data]);
  const [kind, setKind] = useState<ProfileItemKind>("education");
  const fieldState = (entry: { value_state: string } | undefined) => entry?.value_state === "known" ? "known" : entry?.value_state === "prefer_not_to_say" ? "prefer_not_to_say" : "unknown";
  const [institutionState, setInstitutionState] = useState(fieldState(progress.profile?.institution));
  const [subjectState, setSubjectState] = useState(fieldState(progress.profile?.subject));
  useEffect(() => {
    if (handoff.data?.message) { setInstitutionState(fieldState(progress.profile?.institution)); setSubjectState(fieldState(progress.profile?.subject)); }
  }, [handoff.data, progress.profile]);
  const [deleteText, setDeleteText] = useState("");
  const readiness = profileReadiness(progress, vault.items);
  const busy = fetcher.state !== "idle";
  const current = profileKindDetails[kind];
  return <main className="profile-page">
    <header className="profile-intro"><div><p className="kicker">Dein privates Bewerbungsprofil</p><h1>Sammle, was du für Bewerbungen wiederverwenden willst.</h1>
      <p className="lede">Fang mit den Angaben an, die beim Abgleich helfen, und ergänz Nachweise und Geschichten nur, wenn sie dir nützen. Alles Freiwillige kannst du überspringen und später nachholen.</p></div>
      <aside className="profile-privacy" aria-label="Datenschutz im Profil"><strong>Nur für dein Konto</strong><p>Nichts hier geht in die Messung. Übernommene Vorschläge bleiben unbestätigt, bis du sie prüfst.</p></aside>
    </header>
    {typeof fetcher.data?.error === "string" && <p className="form-error profile-feedback" role="alert">{fetcher.data.error}</p>}
    {typeof fetcher.data?.message === "string" && <p className="profile-feedback" role="status">{fetcher.data.message}</p>}
    {handoff.data?.error && <p role="alert">{handoff.data.error} Deine Angaben bleiben hier, damit du es noch einmal versuchen kannst.</p>}
    {handoff.data?.message && <p role="status">Deine bestätigten Angaben sind unten gespeichert. {saveCall && /^[1-9][0-9]{0,17}$/.test(saveCall) && <Link to={`/account?save=${saveCall}`}>Das ausgewählte Stipendium merken</Link>}</p>}
    {pendingContext && <section className="notice"><h2>Deine geprüften Angaben speichern</h2><p>Das sind die Angaben, die du vor der Anmeldung bestätigt hast. Beim Speichern ersetzen sie deine Grundangaben unten und ergänzen geprüfte Nachweise in diesem Profil. Prüf Unterschiede vor dem Speichern.</p>
      <ul>{Object.entries(pendingContext.profile.facts).map(([field, fact]) => <li key={field}>{fieldWords[field] || field.replaceAll("_", " ")}: {factWords(fact)}{progress.profile?.[field] && progress.profile[field].value !== fact.value && <strong> · gerade gespeichert: {factWords(progress.profile[field])}</strong>}</li>)}
      {pendingContext.items.map((item, i) => <li key={i}>{profileKindDetails[item.content.kind as ProfileItemKind]?.label || item.content.kind}: {item.content.summary || item.content.title} · {item.source === "cv_import" ? "Lebenslauf, von dir geprüft" : "Von dir eingetragen und geprüft"}</li>)}</ul>
      <handoff.Form method="post"><input type="hidden" name="intent" value="discovery-context" /><input type="hidden" name="context" value={JSON.stringify(pendingContext)} /><button className="button" disabled={handoff.state !== "idle"}>Bestätigte Angaben speichern</button></handoff.Form>
      <button type="button" className="text-button" onClick={() => { window.sessionStorage.removeItem(contextStorageKey); setPendingContext(null); }}>Vorläufige Angaben verwerfen</button>
    </section>}
    <div className="profile-workspace">
      <aside className="profile-rail" aria-label="Fortschritt im Profil">
        <section className="readiness-summary"><h2>Dein Stand</h2>
          <div><strong>{readiness.matchingKnown}/{readiness.matchingTotal}</strong><span>Grundangaben für den Abgleich bekannt</span></div>
          <p>{readiness.matchingAnswered === readiness.matchingTotal ? "Du hast alle Grundangaben geprüft." : "Füll die Grundangaben aus, wenn du kannst. „Weiß ich nicht“ und „Möchte ich nicht sagen“ sind gültige Antworten, können aber dazu führen, dass du einen Abgleich selbst prüfen musst."}</p>
          <dl><div><dt>Bestätigte Nachweise</dt><dd>{readiness.evidence}</dd></div><div><dt>Wiederverwendbare Geschichten</dt><dd>{readiness.stories}</dd></div><div><dt>Vorschläge zu prüfen</dt><dd>{readiness.candidates}</dd></div></dl>
        </section>
        <nav className="profile-index" aria-label="Bereiche im Profil"><a href="#matching-basics">Grundangaben</a>{profileKinds.map((entry) => {
          const count = vault.items.filter((item) => item.kind === entry.kind && item.confirmation_state !== "rejected").length;
          return <a key={entry.kind} href={`#${entry.kind}`}>{entry.label}<span>{count}</span></a>;
        })}</nav>
      </aside>
      <div className="profile-content">
        <section id="matching-basics" className="profile-step"><p className="step-label">Fang hier an</p><h2>Grundangaben</h2>{progress.profile_provenance && <details><summary>Quellen und Bestätigungsverlauf</summary><ul>{Object.entries(progress.profile_provenance).map(([field, history]) => <li key={field}><strong>{fieldWords[field] || field.replaceAll("_", " ")}:</strong> {history.map(entry => `${entry.kind === "cv_import" ? "Lebenslauf" : entry.kind === "student_confirmed" ? "Von dir bestätigt" : "Von dir eingetragen"}${entry.transformation === "correction" ? " (Korrektur)" : ""}`).join(" → ")}</li>)}</ul></details>}<p><Link to="/">Angaben über den Chat oder einen Lebenslauf ergänzen</Link>. Prüf sie und speichere sie in dieses Profil; vorhandene Nachweise bleiben erhalten.</p>
          <p>Diese vier Angaben zum Studium helfen beim Abgleich mit häufigen Bedingungen. Wähl „Weiß ich nicht“ oder „Möchte ich nicht sagen“, wenn das die ehrliche Antwort ist; beides ist kein Fehler. Dein Vorhaben ist freiwillig.</p>
          <fetcher.Form method="post" className="profile-form matching-profile-form" key={JSON.stringify(progress.profile)}>
            <input type="hidden" name="intent" value="matching-profile" />
            <label><span>Hochschule</span><select name="institution_state" value={institutionState} onChange={(event) => setInstitutionState(event.target.value)}><option value="known">Weiß ich</option><option value="unknown">Weiß ich nicht</option><option value="prefer_not_to_say">Möchte ich nicht sagen</option></select></label>
            {institutionState === "known" && <label><span>Name der Hochschule</span><input name="institution" maxLength={160} required defaultValue={value(progress.profile?.institution)} /></label>}
            <label><span>Studium</span><select name="degree" defaultValue={selected(progress.profile?.degree_level)}><option value="">Weiß ich nicht</option><option value="prefer_not_to_say">Möchte ich nicht sagen</option><option value="bachelor">Bachelor</option><option value="master">Master</option><option value="doctoral">Promotion</option></select></label>
            <label><span>Fach oder Studiengang</span><select name="subject_state" value={subjectState} onChange={(event) => setSubjectState(event.target.value)}><option value="known">Weiß ich</option><option value="unknown">Weiß ich nicht</option><option value="prefer_not_to_say">Möchte ich nicht sagen</option></select></label>
            {subjectState === "known" && <label><span>Name des Fachs oder Studiengangs</span><input name="subject" maxLength={160} required defaultValue={value(progress.profile?.subject)} /></label>}
            <label><span>Fachsemester</span><select name="semester" defaultValue={selected(progress.profile?.semester_number)}><option value="">Weiß ich nicht</option><option value="prefer_not_to_say">Möchte ich nicht sagen</option>{Array.from({ length: 20 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
            <label><span>Vorhaben <small>Freiwillig, hilft bei Fristen für Auslandsaufenthalt, Praktikum, Abschlussarbeit oder Abschluss</small></span><select name="plan" defaultValue={selected(progress.profile?.milestone)}><option value="">Überspringen oder weiß ich nicht</option><option value="prefer_not_to_say">Möchte ich nicht sagen</option><option value="exchange">Auslandsaufenthalt</option><option value="internship">Praktikum</option><option value="thesis">Abschlussarbeit</option><option value="graduation">Abschluss</option></select></label>
            <label><input type="checkbox" name="adult" value="yes" required /> Ich bestätige, dass ich mindestens 18 bin, und möchte, dass Scholarable diese Angaben speichert.</label>
            <button className="button" disabled={busy}>Grundangaben speichern</button>
          </fetcher.Form>
        </section>
        <section id="add-profile-item" className="profile-step profile-add"><p className="step-label">Ergänz, was nützt</p><h2>{current.prompt}</h2><p>{current.help}</p>
          <fetcher.Form method="post" className="profile-form vault-form"><input type="hidden" name="intent" value="item-create" />
            <label><span>Bereich</span><select id="profile-kind" name="kind" value={kind} onChange={(event) => setKind(event.target.value as ProfileItemKind)}>{profileKinds.map((entry) => <option key={entry.kind} value={entry.kind}>{entry.label}</option>)}</select></label>
            <ItemFields kind={kind} /><div className="profile-form-actions"><button className="button" disabled={busy}>Zu „{current.label}“ hinzufügen</button><a href="#profile-library">Jetzt überspringen</a></div>
          </fetcher.Form>
        </section>
        <section id="profile-library" className="profile-library"><h2>Deine Nachweise und Geschichten</h2><p>Was du selbst einträgst, ist beim Speichern bestätigt. Übernommene Einträge bleiben Vorschläge, bis du sie ausdrücklich bestätigst.</p>
          {vault.items.length === 0 && <p className="vault-empty">Dein Profil ist noch leer. Ergänz oben eine nützliche Angabe oder lass es leer und komm wieder, wenn du so weit bist.</p>}
          {profileKinds.map((entry) => {
            const items = vault.items.filter((item) => item.kind === entry.kind);
            return <section id={entry.kind} className="profile-category" key={entry.kind}><header><h3>{entry.label}</h3><div><p>{entry.help}</p><button type="button" className="text-button" onClick={() => {
              setKind(entry.kind);
              requestAnimationFrame(() => { document.getElementById("profile-kind")?.focus(); document.getElementById("add-profile-item")?.scrollIntoView({ behavior: "smooth" }); });
            }}>Zu „{entry.label}“ hinzufügen</button></div></header>
              {items.length === 0 ? <p className="category-empty">Noch nichts unter „{entry.label}“. Dieser Bereich ist freiwillig.</p>
                : <div className="vault-list">{items.map((item) => <ProfileItemCard key={item.id} item={item} busy={busy} />)}</div>}
            </section>;
          })}
        </section>
        <section className="profile-controls"><h2>Herunterladen oder löschen</h2><p>Lade eine Kopie deines Profils mit Versionsverlauf, Schnappschüssen und gespeichertem Stand herunter. Einzelne Einträge löschst du oben, alle gespeicherten Scholarable-Daten hier.</p>
          <form method="get" action="/account/download"><button className="text-button" disabled={busy}>Meine Daten herunterladen</button></form>
          <fetcher.Form method="post" className="inline-form"><input type="hidden" name="intent" value="delete-data" />
            <label>Gib DELETE ein, um zu bestätigen <input name="confirm" value={deleteText} onChange={(event) => setDeleteText(event.target.value)} autoComplete="off" /></label>
            <button disabled={busy || deleteText !== "DELETE"}>Alle gespeicherten Daten löschen</button>
          </fetcher.Form><p><Link to="/account">Zurück zu „Gemerkt“</Link></p>
        </section>
      </div>
    </div>
  </main>;
}
