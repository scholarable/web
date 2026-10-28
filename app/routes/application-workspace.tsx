import { studentAuthLoader as authkitLoader } from "../lib/student-auth.server";
import { data, Link, redirect, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/application-workspace";
import { ApplicationGuide } from "../components/application-guide";
import { dateTimeDe, documentStateDe, draftStateDe, outcomesDe, requirementKindDe, stagesDe, themeDe, writingActionDe } from "../lib/copy-de";
import { messageDe } from "../lib/messages-de";
import { sampleAccountAllowed, sampleCallId, sampleGuide, sampleTitle, sampleWritingFact, sampleWritingReady, type PracticeWritingEnv } from "../lib/account-sample";
import { reviewAnswer, writingActions, type WritingAction } from "../lib/answer-review";
import { assistWriting, type WritingEnv, type WritingSuggestion } from "../lib/answer-assistance.server";
import { answerThemes, reuseWarnings, suggestedAnswers, suggestedStories, type AnswerTheme } from "../lib/answer-library";
import { callFromPayload, recommend } from "../lib/matching";
import { readMatchingCalls } from "../lib/matches.server";
import { publicDetails } from "../lib/public-details";
import { servingGuide } from "../lib/serving.server";
import { requireSameOriginPost, requireStudentAuth, studentAuthEnv, studentConnection } from "../lib/student-auth.server";
import { documentEnv, documentsReady, readDocuments } from "../lib/student-documents.server";
import {
  captureStudentApplicationSubmission, createStudentApplicationWorkspace, createStudentPracticeWorkspace,
  deleteStudentApplicationWorkspace, readStudentApplicationWorkspace, readStudentProgress,
  readStudentAnswerLibrary, readStudentPracticeWorkspace, readStudentProfileVault, saveStudentAnswerToLibrary,
  refreshStudentApplicationWorkspace, setStudentApplicationOutcome, setStudentApplicationState,
  setStudentApplicationScope,
  updateStudentApplicationDocument, updateStudentApplicationDraft, updateStudentApplicationNote,
  type DocumentState, type DraftState, type StudentOutcome,
} from "../lib/student-progress.server";

export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
export const meta = () => [{ title: "Bewerbung vorbereiten | Scholarable" }];
type ActionResult = { message?: string; error?: string; assistance?: WritingSuggestion & { questionId: string } };
const validCallId = (value: string | undefined) => value && /^[1-9][0-9]{0,17}$/.test(value) ? value : null;

export async function loader(args: Route.LoaderArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context));
  const callId = validCallId(args.params.callId);
  if (!callId) throw new Response("Application workspace not found", { status: 404 });
  return authkitLoader(args, async ({ auth, getAccessToken }) => {
    if (!auth.user.emailVerified || auth.impersonator) throw new Response("Verified student account required", { status: 403 });
    const testOnly = callId === sampleCallId;
    if (testOnly && !sampleAccountAllowed(auth.user.email, studentAuthEnv(args.context)?.SCHOLARABLE_TEST_ACCOUNT_EMAIL))
      throw new Response("Application workspace not found", { status: 404 });
    const { query, digest } = await studentConnection(args.context, auth.user.id, getAccessToken());
    const [workspace, progress, library, vault] = await Promise.all([
      testOnly ? readStudentPracticeWorkspace(query, digest) : readStudentApplicationWorkspace(query, digest, callId),
      readStudentProgress(query, digest), readStudentAnswerLibrary(query, digest), readStudentProfileVault(query, digest),
    ]);
    const saved = progress.opportunities.some(item => String(item.call_id) === callId && item.disposition === "saved");
    if (!saved && !testOnly) throw new Response("Save this opportunity before opening a workspace", { status: 404 });
    let scholarship: { title: string; slug: string; details: ReturnType<typeof publicDetails> } | null = null;
    let eligibility: { label: string; status: string }[] = [];
    if (!testOnly) try {
      const row = (await readMatchingCalls(studentAuthEnv(args.context))).find(item => String(item.id) === callId);
      if (row) {
        scholarship = { title: row.title, slug: row.slug, details: publicDetails(row.details, row.matching_payload) };
        const variants = recommend([callFromPayload(row.matching_payload)], { facts: progress.profile || {} })
          .filter(variant => !workspace || variant.track_id === workspace.selected_track_id
            && variant.route_id === workspace.selected_route_id);
        const checks = new Map<string, { label: string; status: string }>();
        for (const variant of variants) for (const criterion of [
          ...variant.criteria.matched, ...variant.criteria.mismatched, ...variant.criteria.unknown,
        ]) checks.set(`${criterion.id}:${criterion.label}`, { label: criterion.label, status: criterion.status });
        eligibility = [...checks.values()];
      }
    } catch { /* Private work remains available when current catalogue serving is unavailable. */ }
    if (testOnly) scholarship = { title: sampleTitle, slug: "", details: publicDetails({}) };
    let createPacket = null;
    if (!workspace) {
      if (testOnly) createPacket = sampleGuide;
      else {
        const guide = await servingGuide(callId, studentAuthEnv(args.context));
        createPacket = guide.state === "ready" ? guide.guide : null;
      }
    }
    const application = progress.applications.find(item => String(item.call_id) === callId) || null;
    const outcome = progress.outcomes.find(item => String(item.call_id) === callId) || null;
    const writingEnv = studentAuthEnv(args.context) as WritingEnv | undefined;
    const writingEnabled = testOnly ? sampleWritingReady(writingEnv as PracticeWritingEnv) : writingEnv?.SCHOLARABLE_WRITING_ENABLED === "true"
      && writingEnv.SCHOLARABLE_WRITING_BUDGET_CONFIRMED === "true" && !!writingEnv.SCHOLARABLE_WRITING_GATEWAY_ID && !!writingEnv.AI;
    const linkedDocuments = !testOnly && documentsReady(documentEnv(args.context))
      ? (await readDocuments(query, digest)).filter(document => document.links.includes(callId)) : [];
    const documentsEnabled = documentEnv(args.context).SCHOLARABLE_DOCUMENTS_ENABLED === "true";
    return data({ callId, workspace, scholarship, eligibility, createPacket, application, outcome, documentsEnabled, linkedDocuments,
      library: library.filter(item => (item.call_id === sampleCallId) === testOnly),
      vault: testOnly ? { items: [sampleWritingFact] } : vault, writingEnabled, testOnly });
  }, { ensureSignedIn: true });
}

const integer = (value: string | null, allowZero = false) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) throw new Error("Invalid edit version");
  return number;
};

export async function action(args: Route.ActionArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context));
  requireSameOriginPost(args.request);
  const callId = validCallId(args.params.callId);
  if (!callId) throw new Response("Application workspace not found", { status: 404 });
  if (!args.request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) {
    throw new Response("Form encoding required", { status: 415 });
  }
  const body = await args.request.text();
  if (body.length > 70000) throw new Response("Form too large", { status: 413 });
  const form = new URLSearchParams(body);
  return authkitLoader(args, async ({ auth, getAccessToken }) => {
    if (!auth.user.emailVerified || auth.impersonator) throw new Response("Verified student account required", { status: 403 });
    const testOnly = callId === sampleCallId;
    if (testOnly && !sampleAccountAllowed(auth.user.email, studentAuthEnv(args.context)?.SCHOLARABLE_TEST_ACCOUNT_EMAIL))
      throw new Response("Application workspace not found", { status: 404 });
    const { query, digest } = await studentConnection(args.context, auth.user.id, getAccessToken());
    const intent = form.get("intent");
    if (testOnly && ["refresh", "scope", "stage", "outcome"].includes(intent || ""))
      return data<ActionResult>({ error: "Bei einer erfundenen Bewerbung nicht möglich." }, { status: 400 });
    try {
      if (intent === "create") {
        if (testOnly) await createStudentPracticeWorkspace(query, digest, sampleGuide);
        else await createStudentApplicationWorkspace(query, digest, callId);
      }
      else if (intent === "refresh") await refreshStudentApplicationWorkspace(query, digest, callId, integer(form.get("version")));
      else if (intent === "scope") await setStudentApplicationScope(query, digest, callId, form.get("trackId") || null,
        form.get("routeId") || "", integer(form.get("version")));
      else if (intent === "note") await updateStudentApplicationNote(query, digest, callId, form.get("note") || "", integer(form.get("version")));
      else if (intent === "draft") await updateStudentApplicationDraft(query, digest, callId, form.get("questionId") || "",
        form.get("answer") || "", form.get("state") as DraftState, integer(form.get("version"), true));
      else if (intent === "library-save") await saveStudentAnswerToLibrary(query, digest, callId,
        form.get("questionId") || "", form.getAll("theme") as AnswerTheme[], form.getAll("profileId"));
      else if (intent === "assist") {
        if (form.get("aiConsent") !== "yes") return data<ActionResult>({ error: "Wähl aus, was du mit der KI teilst, und bestätige es." }, { status: 400 });
        const [workspace, progress, library, vault] = await Promise.all([
          testOnly ? readStudentPracticeWorkspace(query, digest) : readStudentApplicationWorkspace(query, digest, callId),
          readStudentProgress(query, digest), readStudentAnswerLibrary(query, digest), readStudentProfileVault(query, digest),
        ]);
        if (!workspace || workspace.packet_status !== "current" || !progress.opportunities.some(item => String(item.call_id) === callId && item.disposition === "saved"))
          return data<ActionResult>({ error: "Dafür braucht es eine aktuelle, gemerkte Bewerbung." }, { status: 400 });
        const questionId = form.get("questionId") || "";
        const question = workspace.packet.questions.find(item => item.id === questionId
          && (item.track_id == null || item.track_id === workspace.selected_track_id)
          && (item.route_id == null || item.route_id === workspace.selected_route_id));
        if (!question) return data<ActionResult>({ error: "Diese Frage gehört nicht zur aktuellen Bewerbung." }, { status: 400 });
        const assistance = await assistWriting({ action: form.get("mode") as WritingAction, question,
          answer: form.get("workingAnswer") || "", otherAnswers: workspace.drafts.filter(item => item.question_id !== questionId).map(item => item.answer),
          selectedProfileIds: form.getAll("sourceProfileId"), selectedAnswerIds: form.getAll("sourceAnswerId"),
          profile: testOnly ? [sampleWritingFact] : vault.items, library: library.filter(item => (item.call_id === sampleCallId) === testOnly) },
          testOnly && sampleWritingReady(studentAuthEnv(args.context) as PracticeWritingEnv)
            ? { ...studentAuthEnv(args.context), SCHOLARABLE_WRITING_ENABLED: "true" } as WritingEnv
            : (studentAuthEnv(args.context) || {}) as WritingEnv);
        return data<ActionResult>({ assistance: { ...assistance, questionId } });
      }
      else if (intent === "document") await updateStudentApplicationDocument(query, digest, callId, form.get("documentId") || "",
        form.get("state") as DocumentState, integer(form.get("version"), true));
      else if (intent === "stage") await setStudentApplicationState(query, digest, callId, form.get("state") as "planned");
      else if (intent === "outcome") await setStudentApplicationOutcome(query, digest, callId, (form.get("outcome") || null) as StudentOutcome | null);
      else if (intent === "snapshot") {
        if (testOnly) return data<ActionResult>({ error: "Eine erfundene Übungsbewerbung kann man nicht einreichen." }, { status: 400 });
        if (form.get("confirm") !== "SUBMITTED") return data<ActionResult>({ error: "Gib SUBMITTED ein, um zu bestätigen, dass du selbst eingereicht hast." }, { status: 400 });
        await captureStudentApplicationSubmission(query, digest, callId);
      } else if (intent === "delete") {
        if (form.get("confirm") !== "DELETE") return data<ActionResult>({ error: "Gib DELETE ein, um diesen Arbeitsbereich zu löschen." }, { status: 400 });
        await deleteStudentApplicationWorkspace(query, digest, callId);
        return redirect("/account");
      } else return data<ActionResult>({ error: "Unbekannte Aktion." }, { status: 400 });
      return data<ActionResult>({ message: "Gespeichert." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/changed; reload/i.test(message)) return data<ActionResult>({ error: "Dieser Arbeitsbereich hat sich in einem anderen Tab geändert. Lade die Seite neu, bevor du speicherst." }, { status: 409 });
      if (/Approve every|required document|exceeds its verified limit|current verified|Refresh the current|Save the opportunity|valid application (route|track)|history limit|snapshot limit|deadline has expired|answer library|linked profile items/i.test(message)) {
        return data<ActionResult>({ error: messageDe(message) }, { status: 400 });
      }
      if (/AI writing is not available|Select fewer sources|selected fact|selected prior answer|Select at least one|too long for AI|cannot be reviewed by AI/i.test(message))
        return data<ActionResult>({ error: messageDe(message) }, { status: 400 });
      if (intent === "assist") return data<ActionResult>({ error: "Die KI konnte bei dieser Antwort nicht sicher helfen. Schreib selbst weiter." }, { status: 503 });
      return data<ActionResult>({ error: "Gerade ließ sich nichts speichern. Deine Änderungen sind nicht übernommen." }, { status: 503 });
    }
  }, { ensureSignedIn: true });
}

const draftStates = ["not_started", "drafting", "ready_for_review", "approved"] as const;

export default function ApplicationWorkspace() {
  const { workspace, scholarship, eligibility, createPacket, application, outcome, library, vault, writingEnabled, testOnly, documentsEnabled, linkedDocuments } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  if (!workspace) return <main className="page-wrap account-page"><p><Link to="/account">← Gemerkt</Link></p>
    <h1>{scholarship?.title || "Bewerbung vorbereiten"}</h1>
    <p className="lede">{testOnly ? "Leg einen privaten, erfundenen Arbeitsbereich an, um das Speichern von Antworten zu testen. Es gibt kein echtes Stipendium und keine Einreichung." : "Leg einen privaten Arbeitsbereich aus der aktuellen, geprüften Fassung der Bewerbungsangaben an. Scholarable reicht nichts beim Anbieter ein."}</p>
    {createPacket ? <><ApplicationGuide guide={createPacket} details={scholarship?.details || publicDetails({})} sample={testOnly} />
      <fetcher.Form method="post"><input type="hidden" name="intent" value="create" /><button className="button" disabled={busy}>Privaten Arbeitsbereich anlegen</button></fetcher.Form></>
      : <p className="notice">Eine aktuelle, geprüfte Fassung der Bewerbungsangaben gibt es gerade nicht. Prüf die offizielle Seite des Anbieters und versuch es wieder, wenn Scholarable eine neue Fassung geprüft hat.</p>}
  </main>;
  const packet = workspace.packet;
  const current = workspace.current_packet;
  const tracks = [...new Set([...packet.routes, ...packet.questions, ...packet.documents, ...packet.windows,
    ...packet.steps, ...packet.selection_stages, ...packet.renewal_policies, ...packet.obligations]
    .map(item => item.track_id).filter((id): id is string => id !== null))];
  const availableRoutes = packet.routes.filter(route => route.availability_status === "available");
  const applies = (item: { track_id: string | null; route_id?: string | null }) =>
    (item.track_id == null || item.track_id === workspace.selected_track_id)
    && (item.route_id == null || item.route_id === workspace.selected_route_id);
  const questions = packet.questions.filter(applies);
  const documents = packet.documents.filter(applies);
  const draft = (id: string) => workspace.drafts.find(item => item.question_id === id);
  const documentState = (id: string) => workspace.checklist.find(item => item.document_id === id);
  const officialRoutes = scholarship?.details.routes.filter(route => route.availability_status === "available" && route.url) || [];
  return <main className="page-wrap account-page"><p><Link to="/account">← Gemerkt</Link></p>
    <h1>{scholarship?.title || `Bewerbung ${workspace.call_id}`}</h1>
    <p className="lede">{testOnly ? "Nur privater Test · erfunden. Nutz erfundene Angaben. Nichts hier ist eine echte Bewerbung oder eine Einreichung beim Anbieter." : "Dein privater Arbeitsbereich. Einreichen kannst du nur beim Anbieter."}</p>
    {workspace.packet_status === "changed" && <section className="notice"><h2>Die Anforderungen haben sich geändert</h2><p>Es gibt eine neuere, geprüfte Fassung. Deine Entwürfe bleiben bei der älteren Fassung, bis du aktualisierst.</p>
      <fetcher.Form method="post"><input type="hidden" name="intent" value="refresh" /><input type="hidden" name="version" value={workspace.version} /><button disabled={busy}>Aktuelle Fassung übernehmen</button></fetcher.Form></section>}
    {workspace.packet_status === "unavailable" && <p className="notice">Diese Fassung ist gerade nicht mehr verfügbar. Deine bisherige Arbeit bleibt sichtbar, aber du kannst keine Einreichung festhalten, bis ein aktueller Bewerbungsweg geprüft ist.</p>}
    {!testOnly && workspace.deadline_status === "expired" && <p className="notice">Die geprüfte Frist für diesen Bewerbungsweg ist vorbei. Behalte den Arbeitsbereich als Verlauf, aber halte keine neue Einreichung mehr fest.</p>}
    {!testOnly && workspace.deadline_status === "unknown" && <p className="notice">Die Frist für diesen Bewerbungsweg ist in der geprüften Fassung nicht eindeutig. Prüf sie auf der Seite des Anbieters, bevor du einreichst.</p>}
    {!testOnly && <section><h2>Bewerbungsweg</h2><p>Wähl die genaue Gruppe und den gerade verfügbaren Bewerbungsweg des Anbieters. Unten stehen nur die Anforderungen, die dafür gelten.</p>
      <fetcher.Form method="post" className="inline-form"><input type="hidden" name="intent" value="scope" /><input type="hidden" name="version" value={workspace.version} />
        {tracks.length > 0 && <label>Gruppe<select name="trackId" defaultValue={workspace.selected_track_id || ""}><option value="" disabled>Gruppe wählen</option>{tracks.map(track => <option key={track} value={track}>{track}</option>)}</select></label>}
        <label>Bewerbungsweg<select name="routeId" defaultValue={workspace.selected_route_id || ""}><option value="">Bewerbungsweg wählen</option>{availableRoutes.map(route => <option key={route.id} value={route.id}>{route.name}{route.track_id ? ` — Gruppe ${route.track_id}` : ""}</option>)}</select></label>
        <button disabled={busy}>Bewerbungsweg speichern</button></fetcher.Form>
      {(!workspace.selected_route_id || tracks.length > 0 && !workspace.selected_track_id) && <p className="notice">Wähl einen verfügbaren Bewerbungsweg und eine Gruppe, bevor du eine Einreichung festhältst.</p>}</section>}
    {current && <section><h2>{testOnly ? "Erfundene Übungsfassung" : "Aktuelles, geprüftes Stipendium"}</h2><p>Fassung {current.packet_version}</p>
      {!testOnly && (officialRoutes.length ? officialRoutes.map(route => <p key={route.id}><a className="button" href={route.url!} target="_blank" rel="noreferrer">Offiziell öffnen: {route.label}</a></p>)
        : <p>Gerade ist kein offizieller Bewerbungsweg veröffentlicht.</p>)}
      <ApplicationGuide guide={current} details={scholarship?.details || publicDetails({})} sample={testOnly} />
    </section>}
    {!testOnly && <section><h2>Voraussetzungen</h2>{eligibility.length ? <ul>{eligibility.map(check => <li key={`${check.label}:${check.status}`}><strong>{check.label}</strong> — {check.status === "match" ? "passt zu deinem bestätigten Profil" : check.status === "mismatch" ? "passt gerade nicht" : "musst du noch bestätigen"}</li>)}</ul>
      : <p>Die Voraussetzungen ließen sich hier nicht vollständig prüfen. Prüf jede Anforderung des Anbieters selbst.</p>}</section>}
    <section><h2>Private Notizen</h2><fetcher.Form method="post"><input type="hidden" name="intent" value="note" /><input type="hidden" name="version" value={workspace.version} />
      <label>Notizen<textarea name="note" defaultValue={workspace.note} maxLength={20000} rows={6} /></label><button disabled={busy}>Notizen speichern</button></fetcher.Form></section>
    <section><h2>Bewerbungsfragen</h2><p>{testOnly ? "Üb mit erfundenen Angaben. Diese Entwürfe sind privat und können nicht eingereicht werden." : `Diese Entwürfe gehören zu Fassung ${packet.packet_version}. Was der Anbieter nicht angibt, bleibt offen.`}</p>
      {questions.length === 0 ? <p>{packet.questions.length === 0 ? packet.questions_status_explanation : "Für den gewählten Bewerbungsweg gelten keine Fragen."}</p> : questions.map(question => { const saved = draft(question.id); const suggestions = suggestedAnswers(library, question.prompt, workspace.call_id, question.id); const stories = suggestedStories(vault.items, question.prompt); const review = reviewAnswer(saved?.answer || "", question, workspace.drafts.filter(item => item.question_id !== question.id).map(item => item.answer)); return <article className="result-card" key={question.id}>
        <h3>{question.position}. {question.prompt}</h3><p>{requirementKindDe(question.requirement_kind)}{question.condition_text ? ` — ${question.condition_text}` : ""}</p>
        <p>{[question.word_limit && `${question.word_limit} Wörter`, question.character_limit && `${question.character_limit} Zeichen`].filter(Boolean).join(" · ") || "Keine Längengrenze vom Anbieter veröffentlicht"}</p>
        <fetcher.Form method="post"><input type="hidden" name="intent" value="draft" /><input type="hidden" name="questionId" value={question.id} /><input type="hidden" name="version" value={saved?.version || 0} />
          <label>Antwort<textarea name="answer" defaultValue={saved?.answer || ""} maxLength={question.character_limit || 20000} rows={8} /></label>
          <label>Stand des Entwurfs<select name="state" defaultValue={saved?.state || "not_started"}>{draftStates.map(state => <option key={state} value={state}>{draftStateDe(state)}</option>)}</select></label>
          <button disabled={busy}>Antwort speichern</button></fetcher.Form>
        {saved?.answer && <details><summary>Gespeicherten Entwurf prüfen</summary><p>{review.words} Wörter · {review.characters} Zeichen. Diese lokale Prüfung kontrolliert keine Fakten und auch nicht, ob jeder Teil der Frage beantwortet ist.</p>
          {review.warnings.length ? <ul>{review.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : <p>Keine Probleme mit der Länge oder mit wörtlichen Wiederholungen gefunden. Prüf Antwort und Nachweise selbst.</p>}</details>}
        {writingEnabled && (question.response_kind === "short_text" || question.response_kind === "long_text") && <details><summary>KI-Schreibhilfe</summary>
          <p>Wähl die bestätigten Angaben oder Geschichten, die du mit Cloudflare AI teilen willst. Frühere Antworten sind Beispiele, keine Belege. Das Ergebnis ist nur ein Vorschlag und wird nie automatisch gespeichert oder freigegeben.</p>
          <fetcher.Form method="post"><input type="hidden" name="intent" value="assist" /><input type="hidden" name="questionId" value={question.id} />
            <fieldset><legend>Bestätigtes Material (bis zu sechs)</legend>{vault.items.filter(item => item.confirmation_state === "confirmed" && !item.has_conflict).map(item =>
              <label key={item.id}><input type="checkbox" name="sourceProfileId" value={item.id} />{item.title}{item.sensitivity === "moderate" ? " — sensibel" : ""}</label>)}</fieldset>
            {suggestions.some(({ item }) => !reuseWarnings(item, vault.items).length) && <fieldset><legend>Früher freigegebene Antworten als Beispiel (bis zu zwei)</legend>{suggestions.filter(({ item }) => !reuseWarnings(item, vault.items).length).map(({ item }) =>
              <label key={item.id}><input type="checkbox" name="sourceAnswerId" value={item.id} />{item.question.prompt}</label>)}</fieldset>}
            <label>Was du bisher geschrieben hast<textarea name="workingAnswer" defaultValue={saved?.answer || ""} maxLength={5000} rows={6} /></label>
            <label>Hilfe bei<select name="mode">{writingActions.map(mode => <option key={mode} value={mode}>{writingActionDe(mode)}</option>)}</select></label>
            <label><input type="checkbox" name="aiConsent" value="yes" required />Diese Frage, meine Arbeitsantwort und das ausgewählte Material für diesen Vorschlag an Cloudflare AI senden.</label>
            <button disabled={busy}>Vorschlag holen</button></fetcher.Form>
          {fetcher.data?.assistance?.questionId === question.id && <section aria-live="polite"><h4>Vorschlag — nicht gespeichert</h4>
            {fetcher.data.assistance.text && <textarea readOnly value={fetcher.data.assistance.text} rows={8} aria-label="KI-Vorschlag zum Prüfen und Kopieren" />}
            {fetcher.data.assistance.claims.length > 0 && <ul>{fetcher.data.assistance.claims.map((claim, index) => <li key={index}>{claim.text} — aus {claim.source_ids.map(id => fetcher.data!.assistance!.sources.find(source => source.id === id)?.label || "ausgewähltem Material").join(", ")}</li>)}</ul>}
            {fetcher.data.assistance.gaps.map(gap => <p key={gap}>Fehlender Nachweis: {gap}</p>)}
            {fetcher.data.assistance.warnings.map(warning => <p className="notice" key={warning}>{warning}</p>)}
            <p>Verwendetes Material: {fetcher.data.assistance.sources.map(source => source.label).join(", ")}. Prüf jede Aussage, bevor du sie in deine Antwort übernimmst.</p></section>}
        </details>}
        {suggestions.length > 0 && <details><summary>Passende Antworten, die du früher gespeichert hast</summary><p>Das ist nur Material; nichts wird in diesen Entwurf eingefügt.</p>
          {suggestions.map(({ item, reason }) => <article key={item.id}><h4>{item.question.prompt}</h4><p>{reason}</p><p>{item.history[0].answer}</p>
            {reuseWarnings(item, vault.items).map(warning => <p className="notice" key={warning}>{warning}</p>)}
            <p><Link to="/account/library">Version und Quelle prüfen</Link>, bevor du etwas kopierst oder anpasst.</p></article>)}</details>}
        {stories.length > 0 && <details><summary>Passende Geschichten aus deinem Profil</summary><p>Das sind deine bestätigten Notizen, keine fertige Antwort.</p>
          {stories.map(({ item, reason }) => <article key={item.id}><h4>{item.title}</h4><p>{reason}</p><p>{item.summary || item.situation || "Öffne dein Profil, um diese Geschichte anzusehen."}</p>
            {item.has_conflict && <p className="notice">Diese Geschichte widerspricht einem anderen Profileintrag. Kläre das, bevor du sie wiederverwendest.</p>}</article>)}
          <p><Link to="/profile">Alle Geschichten im Profil ansehen</Link></p></details>}
        {saved?.state === "approved" && <details><summary>Diese freigegebene Antwort in meiner Bibliothek speichern</summary><p>Das ist ein eigener, ausdrücklicher Schritt. Spätere Änderungen werden zu neuen freigegebenen Versionen; festgehaltene Einreichungen ändern sich nicht.</p>
          <fetcher.Form method="post"><input type="hidden" name="intent" value="library-save" /><input type="hidden" name="questionId" value={question.id} />
            <fieldset><legend>Wiederverwendbare Themen</legend>{answerThemes.map(theme => <label key={theme}><input type="checkbox" name="theme" value={theme} />{themeDe(theme)}</label>)}</fieldset>
            <fieldset><legend>Verwendete bestätigte Angaben und Geschichten</legend>{(testOnly ? [] : vault.items).filter(item => item.confirmation_state === "confirmed").map(item => <label key={item.id}><input type="checkbox" name="profileId" value={item.id} />{item.title}</label>)}</fieldset>
            <button disabled={busy}>In der Antwortbibliothek speichern</button></fetcher.Form></details>}
      </article>; })}</section>
    {documentsEnabled && <section><h2>Private Kopien deiner Dokumente</h2><p><Link to="/account/documents">Deine Dokumente verwalten</Link>. Lade Kopien herunter und reich sie selbst über den offiziellen Weg des Anbieters ein. Eine verknüpfte Datei hakt keine Anforderung ab.</p>
      {linkedDocuments.map(document => <p key={document.id}><Link reloadDocument to={`/account/documents/${document.id}/download/${document.latest_version}`}>{document.name} · Version {document.latest_version}</Link>{document.review_due && <> · <Link to="/account/documents">Weitere Speicherung prüfen</Link></>}</p>)}</section>}
    <section><h2>Dokumente</h2>{documents.length ? documents.map(document => { const saved = documentState(document.id); return <article className="result-card" key={document.id}><h3>{document.name}</h3>
      <p>{requirementKindDe(document.requirement_kind)}{document.condition_text ? ` — ${document.condition_text}` : ""}</p>
      <fetcher.Form method="post" className="inline-form"><input type="hidden" name="intent" value="document" /><input type="hidden" name="documentId" value={document.id} /><input type="hidden" name="version" value={saved?.version || 0} />
        <label>Status<select name="state" defaultValue={saved?.state || "not_started"}><option value="not_started">{documentStateDe("not_started")}</option><option value="ready">{documentStateDe("ready")}</option>{document.requirement_kind !== "required" && <option value="not_applicable">{documentStateDe("not_applicable")}</option>}</select></label><button disabled={busy}>Dokument speichern</button></fetcher.Form></article>; }) : <p>In dieser Fassung sind keine Dokumente veröffentlicht.</p>}</section>
    {(workspace.archived_drafts.length > 0 || workspace.archived_checklist.length > 0) && <section><h2>Arbeit aus früheren Fassungen</h2><p>Nur zum Lesen: Arbeit aus älteren, geprüften Fassungen. Sie zählt weder für die aktuelle Dokumentenliste noch für eine neue Einreichung.</p>
      {workspace.archived_drafts.map((item, index) => <article className="result-card" key={`${item.packet_version}:${item.question.id}:${index}`}><h3>{item.question.prompt}</h3><p>Fassung {item.packet_version} · {draftStateDe(item.state)}</p><p>{item.answer || "Keine Antwort gespeichert."}</p></article>)}
      {workspace.archived_checklist.map((item, index) => <p key={`${item.packet_version}:${item.document.id}:${index}`}>{item.document.name} — {documentStateDe(item.state)} (Fassung {item.packet_version})</p>)}</section>}
    {!testOnly && <section><h2>Stand und Ergebnis</h2><fetcher.Form method="post" className="inline-form"><input type="hidden" name="intent" value="stage" /><label>Mein Stand<select name="state" defaultValue={application?.state || "planned"}>{stagesDe.map(([state, label]) => <option key={state} value={state}>{label}</option>)}</select></label><button disabled={busy}>Stand speichern</button></fetcher.Form>
      <fetcher.Form method="post" className="inline-form"><input type="hidden" name="intent" value="outcome" /><label>Mein Ergebnis<select name="outcome" defaultValue={outcome?.outcome || ""}><option value="">Noch nichts</option>{outcomesDe.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button disabled={busy}>Ergebnis speichern</button></fetcher.Form></section>}
    {!testOnly && <section><h2>Einreichungen festhalten</h2><p>Wenn du beim Anbieter eingereicht hast, halte hier einen unveränderlichen Schnappschuss der freigegebenen Antworten, der Dokumentenliste und der Fassung fest.</p>
      <fetcher.Form method="post" className="inline-form"><input type="hidden" name="intent" value="snapshot" /><label>Gib SUBMITTED ein <input name="confirm" autoComplete="off" /></label><button disabled={busy || workspace.packet_status !== "current" || workspace.deadline_status === "expired" || !workspace.selected_route_id || tracks.length > 0 && !workspace.selected_track_id}>Einreichung festhalten</button></fetcher.Form>
      {workspace.submissions.map(snapshot => <article className="result-card" key={snapshot.id}><h3>Eingereicht am {dateTimeDe(snapshot.submitted_at)}</h3><p>Fassung {snapshot.packet_version} · {snapshot.approved_answers.length} freigegebene Antworten · {snapshot.checklist.length} Dokumente</p></article>)}</section>}
    <section className="account-controls"><h2>Arbeitsbereich löschen</h2><p>Das löscht nur diesen Arbeitsbereich mit Entwürfen, Dokumentenliste und Schnappschüssen. Dein Profil und deine wiederverwendbaren Nachweise bleiben.</p>
      <fetcher.Form method="post" className="inline-form"><input type="hidden" name="intent" value="delete" /><label>Gib DELETE ein <input name="confirm" autoComplete="off" /></label><button disabled={busy}>Arbeitsbereich löschen</button></fetcher.Form></section>
    {fetcher.data?.error && <p className="form-error" role="alert">{fetcher.data.error}</p>}{fetcher.data?.message && <p role="status">{fetcher.data.message}</p>}
  </main>;
}
