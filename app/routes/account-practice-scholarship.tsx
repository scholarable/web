import { studentAuthLoader as authkitLoader } from "../lib/student-auth.server";
import { data, Link, useFetcher, useLoaderData } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/account-practice-scholarship";
import { ApplicationGuide } from "../components/application-guide";
import { assistWriting, type WritingSuggestion } from "../lib/answer-assistance.server";
import { publicDetails } from "../lib/public-details";
import { sampleAccountAllowed, sampleGuide, sampleTitle, sampleWritingFact, sampleWritingReady, type PracticeWritingEnv } from "../lib/account-sample";
import { requireSameOriginPost, requireStudentAuth, studentAuthEnv } from "../lib/student-auth.server";

export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
export const meta = () => [{ title: "Übungs-Stipendium | Scholarable" }];
const writingEnv = (context: unknown) => studentAuthEnv(context) as PracticeWritingEnv | undefined;
export const writingReady = sampleWritingReady;
type ActionResult = { assistance?: WritingSuggestion; error?: string };

export async function loader(args: Route.LoaderArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context));
  return authkitLoader(args, async ({ auth }) => {
    if (!auth.user.emailVerified || auth.impersonator
      || !sampleAccountAllowed(auth.user.email, studentAuthEnv(args.context)?.SCHOLARABLE_TEST_ACCOUNT_EMAIL)) {
      throw new Response("Not found", { status: 404 });
    }
    return { writingTestEnabled: writingReady(writingEnv(args.context)) };
  }, { ensureSignedIn: true });
}

export async function action(args: Route.ActionArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context));
  requireSameOriginPost(args.request);
  if (!args.request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded"))
    throw new Response("Form encoding required", { status: 415 });
  const body = await args.request.text();
  if (body.length > 10000) throw new Response("Form too large", { status: 413 });
  const form = new URLSearchParams(body);
  return authkitLoader(args, async ({ auth }) => {
    if (!auth.user.emailVerified || auth.impersonator
      || !sampleAccountAllowed(auth.user.email, studentAuthEnv(args.context)?.SCHOLARABLE_TEST_ACCOUNT_EMAIL))
      throw new Response("Not found", { status: 404 });
    const env = writingEnv(args.context);
    if (!writingReady(env)) return data<ActionResult>({ error: "Die KI-Übung ist gerade nicht verfügbar." }, { status: 503 });
    const mode = form.get("mode");
    if (form.get("intent") !== "assist" || form.get("aiConsent") !== "yes"
      || form.getAll("sourceProfileId").length !== 1 || form.get("sourceProfileId") !== "1"
      || mode !== "draft" && mode !== "critique")
      return data<ActionResult>({ error: "Wähl die erfundene Angabe aus und bestätige diese KI-Anfrage." }, { status: 400 });
    try {
      const assistance = await assistWriting({ action: mode, question: sampleGuide.questions[0],
        answer: form.get("answer") || "", otherAnswers: [], selectedProfileIds: ["1"], selectedAnswerIds: [],
        profile: [sampleWritingFact], library: [] }, { ...env, SCHOLARABLE_WRITING_ENABLED: "true" });
      return data<ActionResult>({ assistance });
    } catch {
      return data<ActionResult>({ error: "Die KI konnte bei dieser Übungsantwort nicht sicher helfen." }, { status: 503 });
    }
  }, { ensureSignedIn: true });
}

export default function AccountPracticeScholarship() {
  const { writingTestEnabled } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [answer, setAnswer] = useState("");
  const [documentReady, setDocumentReady] = useState(false);
  const [stage, setStage] = useState("planned");
  return <main className="page-wrap account-page">
    <p className="kicker">Nur privater Test · erfunden</p>
    <h1>{sampleTitle}</h1>
    <p className="lede">Auf dieser Seite kannst du den Aufbau einer Bewerbung ausprobieren. Es gibt kein echtes Stipendium, keinen Anbieter, keine Frist und keine Einreichung. Gib keine persönlichen Angaben ein und lade keine Dokumente hoch.</p>
    <p className="notice">Übungsänderungen bleiben in diesem Tab und werden nicht in deinem Konto gespeichert. Nur ein ausdrücklicher KI-Test schickt die erfundene Frage, die ausgewählte Angabe und deine Übungsantwort an Cloudflare.</p>
    <section><h2>Übungsstand</h2>
      <label>Stand <select value={stage} onChange={(event) => setStage(event.target.value)}>
        <option value="planned">Geplant</option><option value="preparing">In Vorbereitung</option><option value="ready_for_review">Bereit zum Prüfen</option>
      </select></label>
      <label><input type="checkbox" checked={documentReady} onChange={(event) => setDocumentReady(event.target.checked)} /> Übungs-Notenübersicht fertig</label>
      <p>Aktueller Übungsstand: {stage === "planned" ? "Geplant" : stage === "preparing" ? "In Vorbereitung" : "Bereit zum Prüfen"}. Dokument: {documentReady ? "fertig" : "nicht fertig"}.</p>
    </section>
    <section><h2>Übungsantwort</h2>
      <label htmlFor="practice-answer">{sampleGuide.questions[0].prompt}</label>
      <textarea id="practice-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={2000} rows={6} placeholder="Nutz nur erfundene Angaben" />
      <p>{answer.trim() ? `${answer.trim().split(/\s+/).length} Wörter in diesem Tab geschrieben` : "Noch keine Antwort"}. Nichts wird eingereicht.</p>
      {writingTestEnabled && <div><h3>Privater Test der KI-Schreibhilfe</h3>
        <p>Nur diese erfundene Frage, die erfundene Angabe unten und deine Übungsantwort gehen an Cloudflare AI, wenn du Hilfe anforderst. Nutz nur erfundene Angaben. Vorschläge werden nicht gespeichert und nicht freigegeben.</p>
        <fetcher.Form method="post"><input type="hidden" name="intent" value="assist" /><input type="hidden" name="answer" value={answer} />
          <label><input type="checkbox" name="sourceProfileId" value="1" required />Erfundene Angabe verwenden: {sampleWritingFact.summary} {sampleWritingFact.outcome}</label>
          <label>Hilfe bei <select name="mode"><option value="draft">Entwurf schreiben</option><option value="critique">Rückmeldung zu meiner Antwort</option></select></label>
          <label><input type="checkbox" name="aiConsent" value="yes" required />Diese erfundenen Angaben und meine Übungsantwort für diesen Test an Cloudflare AI senden.</label>
          <button disabled={fetcher.state !== "idle"}>KI-Hilfe testen</button>
        </fetcher.Form>
        {fetcher.data?.error && <p role="alert">{fetcher.data.error}</p>}
        {fetcher.data?.assistance && <section aria-live="polite"><h4>KI-Ergebnis — nicht gespeichert</h4>
          {fetcher.data.assistance.text && <textarea readOnly value={fetcher.data.assistance.text} rows={6} aria-label="KI-Vorschlag zur Übung" />}
          {fetcher.data.assistance.claims.length > 0 && <ul>{fetcher.data.assistance.claims.map((claim, index) =>
            <li key={index}>{claim.text} — aus {fetcher.data!.assistance!.sources.find(source => source.id === claim.source_ids[0])?.label || "erfundener Angabe"}</li>)}</ul>}
          {fetcher.data.assistance.gaps.map(gap => <p key={gap}>Fehlender Nachweis: {gap}</p>)}
          {fetcher.data.assistance.warnings.map(warning => <p key={warning}>{warning}</p>)}
          <p>Prüf jede Aussage selbst. Nichts wird eingereicht.</p>
        </section>}
      </div>}
    </section>
    <ApplicationGuide guide={sampleGuide} details={publicDetails({})} sample />
    <p><Link className="text-link" to="/account">Zurück zu Gemerkt</Link></p>
  </main>;
}
