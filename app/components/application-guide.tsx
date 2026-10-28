import { incomplete, type ApplicationGuideData, type CallGuideData, type GuidePart } from "../lib/application-guide";
import type { PublicDetails } from "../lib/public-details";
import { dateLong, documentPhaseDe, obligationDe, policyDe, requirementKindDe, submittedByDe } from "../lib/copy-de";

// Reviewed application details in German. The scholarship page places each
// part in its own section; timing lives in the page's own timeline. The page's
// guide has each part's coverage: a part the checks found incomplete shows what
// was verified and says the rest is on the provider's page.
type Guide = Pick<ApplicationGuideData, "routes" | "questions" | "documents" | "steps" | "selection_stages" | "renewal_policies" | "obligations">
  & Partial<Pick<ApplicationGuideData, "questions_status" | "questions_status_explanation">> & { parts?: CallGuideData["parts"] };
type Parts = { guide: Guide; details: PublicDetails };
const MISSING: Record<GuidePart, [string, string]> = {
  application_steps: ["Die Schritte sind hier nicht vollständig.", "Die Schritte stehen auf der Seite des Anbieters."],
  documents: ["Die Unterlagen sind hier nicht vollständig.", "Die Unterlagen stehen auf der Seite des Anbieters."],
  application_questions: ["Die Bewerbungsfragen sind hier nicht vollständig.", "Die Bewerbungsfragen stehen auf der Seite des Anbieters."],
  selection: ["Die Auswahl ist hier nicht vollständig beschrieben.", "Die Auswahl beschreibt der Anbieter auf seiner Seite."],
  renewal: ["Die Regeln zur Verlängerung sind hier nicht vollständig.", "Die Regeln zur Verlängerung stehen auf der Seite des Anbieters."],
  obligations: ["Die Pflichten sind hier nicht vollständig.", "Die Pflichten stehen auf der Seite des Anbieters."],
};
// The line under an incomplete part: with verified items shown, or instead of them.
export function PartHint({ part, shown }: { part: GuidePart; shown: boolean }) {
  return <p className="quiet-line">{shown ? `${MISSING[part][0]} Was fehlt, steht auf der Seite des Anbieters.` : MISSING[part][1]}</p>;
}
// Whether the "after the application" parts have anything to show.
export const showsAfter = (guide: Guide) => guide.selection_stages.length > 0 || guide.renewal_policies.length > 0
  || guide.obligations.length > 0 || (["selection", "renewal", "obligations"] as const).some(part => incomplete(guide, part));
const scopeOf = (details: PublicDetails) => (trackId: string | null, routeId: string | null) => {
  const labels = [
    trackId ? details.tracks.find(track => track.id === trackId)?.label || "Bestimmte Gruppe, siehe offizielle Seite" : null,
    routeId ? details.routes.find(route => route.id === routeId)?.label || "Bestimmter Weg, siehe offizielle Seite" : null,
  ].filter(Boolean);
  return labels.length ? labels.join(" · ") : null;
};
const day = (value: string | null) => value ? dateLong(value) || value : null;

export function GuideSteps({ guide, details }: Parts) {
  const scope = scopeOf(details);
  const groups = new Map<string, typeof guide.steps>();
  for (const step of guide.steps) {
    const key = JSON.stringify([step.track_id, step.route_id]);
    groups.set(key, [...(groups.get(key) || []), step]);
  }
  if (!guide.routes.length && !guide.steps.length) return null;
  return <div className="guide-group"><h3>Schritte</h3>
    {guide.routes.map(route => <p key={route.id}><strong>{route.name}.</strong> {route.instructions}{route.track_id && scope(route.track_id, null) && <span className="guide-meta"> · {scope(route.track_id, null)}</span>}</p>)}
    {[...groups].map(([key, steps]) => <div key={key} className="guide-sequence">
      {groups.size > 1 && <h4>{scope(steps[0].track_id, steps[0].route_id) || "Allgemeine Schritte"}</h4>}
      <ol className="steps">{steps.map(step => <li key={step.id}>
        <strong>{step.title}</strong>
        {step.instructions && <p>{step.instructions}</p>}
        {step.due_on && <p>Bis {day(step.due_on)}; die Uhrzeit bitte beim Anbieter prüfen.</p>}
      </li>)}</ol></div>)}
  </div>;
}

export function GuideDocuments({ guide, details }: Parts) {
  const scope = scopeOf(details);
  const missing = incomplete(guide, "documents");
  if (!guide.documents.length && !missing) return null;
  const order = { required: 0, conditional: 1, optional: 2 } as const;
  return <div className="guide-group"><h3>Unterlagen</h3>
    {guide.documents.length > 0 && <ul className="docs">{[...guide.documents].sort((a, b) => order[a.requirement_kind] - order[b.requirement_kind]).map(doc => <li key={doc.id}>
      <div className="row"><strong>{doc.name}</strong> <span className={`tag ${doc.requirement_kind === "required" ? "must" : "cond"}`}>{requirementKindDe(doc.requirement_kind)}</span></div>
      <p className="guide-meta">{documentPhaseDe(doc.document_phase)} · eingereicht {submittedByDe(doc.submitted_by)}{scope(doc.track_id, doc.route_id) ? ` · ${scope(doc.track_id, doc.route_id)}` : ""}</p>
      {doc.condition_text && <p><strong>Wenn:</strong> {doc.condition_text}</p>}
      {doc.instructions && <p>{doc.instructions}</p>}
      {doc.accepted_formats.length > 0 && <p>Formate: {doc.accepted_formats.join(", ")}</p>}
      {(doc.max_file_size_mb || doc.max_pages || doc.max_words || doc.max_characters) && <p>Grenzen: {[doc.max_file_size_mb && `${doc.max_file_size_mb} MB`, doc.max_pages && `${doc.max_pages} Seiten`, doc.max_words && `${doc.max_words} Wörter`, doc.max_characters && `${doc.max_characters} Zeichen`].filter(Boolean).join(" · ")}</p>}
      {doc.due_on && <p>Bis {day(doc.due_on)}; die Uhrzeit bitte beim Anbieter prüfen.</p>}
    </li>)}</ul>}
    {missing && <PartHint part="documents" shown={guide.documents.length > 0} />}
  </div>;
}

export function GuideQuestions({ guide, details }: Parts) {
  const scope = scopeOf(details);
  const list = guide.questions.length > 0 && <ol className="docs">{guide.questions.map(question => <li key={question.id}>
      <div className="row"><strong>{question.prompt}</strong> <span className={`tag ${question.requirement_kind === "required" ? "must" : "cond"}`}>{requirementKindDe(question.requirement_kind)}</span></div>
      {scope(question.track_id, question.route_id) && <p className="guide-meta">{scope(question.track_id, question.route_id)}</p>}
      {question.help_text && <p>{question.help_text}</p>}
      {question.condition_text && <p><strong>Wenn:</strong> {question.condition_text}</p>}
      {question.word_limit && <p>Höchstens {question.word_limit} Wörter</p>}
      {question.character_limit && <p>Höchstens {question.character_limit} Zeichen</p>}
      {question.options.length > 0 && <p>Antwortmöglichkeiten: {question.options.join(" · ")}</p>}
    </li>)}</ol>;
  if (guide.parts) {
    const missing = incomplete(guide, "application_questions");
    if (!list && !missing) return guide.parts.application_questions === "not_published"
      ? <div className="guide-group"><h3>Bewerbungsfragen</h3><p>Der Anbieter nennt keine eigenen Bewerbungsfragen.</p></div> : null;
    return <div className="guide-group"><h3>Bewerbungsfragen</h3>{list}{missing && <PartHint part="application_questions" shown={!!list} />}</div>;
  }
  if (guide.questions_status === "complete" && !guide.questions.length) return null;
  return <div className="guide-group"><h3>Bewerbungsfragen</h3>
    {guide.questions_status === "complete" ? list : <p>{guide.questions_status_explanation}</p>}
  </div>;
}

export function GuideAfter({ guide, details }: Parts) {
  const scope = scopeOf(details);
  const groups = new Map<string, typeof guide.selection_stages>();
  for (const stage of guide.selection_stages) {
    const key = stage.track_id || "general";
    groups.set(key, [...(groups.get(key) || []), stage]);
  }
  if (!showsAfter(guide)) return null;
  const later = incomplete(guide, "renewal") || incomplete(guide, "obligations");
  return <>
    {(guide.selection_stages.length > 0 || incomplete(guide, "selection")) && <div className="guide-group"><h3>Auswahl</h3>
      {[...groups].map(([key, stages]) => <div key={key} className="guide-sequence">
        {groups.size > 1 && <h4>{scope(stages[0].track_id, null) || "Allgemeine Auswahl"}</h4>}
        <ol className="steps">{stages.map(stage => <li key={stage.id}>
          <strong>{stage.title}</strong>
          {stage.actor && <p>Durch: {stage.actor}</p>}
          {stage.description && <p>{stage.description}</p>}
          {stage.criteria_text && <p>Kriterien: {stage.criteria_text}</p>}
          {stage.expected_on && <p>Voraussichtlich {day(stage.expected_on)}; bitte beim Anbieter prüfen.</p>}
        </li>)}</ol></div>)}
      {incomplete(guide, "selection") && <PartHint part="selection" shown={guide.selection_stages.length > 0} />}
    </div>}
    {(guide.renewal_policies.length > 0 || guide.obligations.length > 0 || later) && <div className="guide-group"><h3>Verlängerung und Pflichten</h3>
      {(guide.renewal_policies.length > 0 || guide.obligations.length > 0) && <ul className="docs">
        {guide.renewal_policies.map(policy => <li key={policy.id}><strong>{policyDe(policy.policy_type)}</strong>{scope(policy.track_id, null) ? ` · ${scope(policy.track_id, null)}` : ""}
          {(policy.initial_duration_months || policy.maximum_duration_months || policy.review_interval_months || policy.maximum_renewals != null) && <p>{[
            policy.initial_duration_months && `Erst einmal ${policy.initial_duration_months} Monate`,
            policy.maximum_duration_months && `höchstens ${policy.maximum_duration_months} Monate`,
            policy.review_interval_months && `Prüfung alle ${policy.review_interval_months} Monate`,
            policy.maximum_renewals != null && `höchstens ${policy.maximum_renewals} Verlängerungen`,
          ].filter(Boolean).join(" · ")}</p>}
          {policy.reapplication_allowed != null && <p>Neu bewerben: {policy.reapplication_allowed ? "möglich" : "nicht möglich"}</p>}
          {policy.requirements_text && <p>{policy.requirements_text}</p>}{policy.extension_text && <p>{policy.extension_text}</p>}</li>)}
        {guide.obligations.map(obligation => <li key={obligation.id}><strong>{obligationDe(obligation.obligation_type)}</strong>{scope(obligation.track_id, null) ? ` · ${scope(obligation.track_id, null)}` : ""}
          <p>{obligation.description}</p>{obligation.condition_text && <p><strong>Wenn:</strong> {obligation.condition_text}</p>}
          {obligation.timing_text && <p>Wann: {obligation.timing_text}</p>}{obligation.consequence_text && <p>Folge: {obligation.consequence_text}</p>}</li>)}
      </ul>}
      {incomplete(guide, "renewal") && <PartHint part="renewal" shown={guide.renewal_policies.length > 0} />}
      {incomplete(guide, "obligations") && <PartHint part="obligations" shown={guide.obligations.length > 0} />}
    </div>}
  </>;
}

// The whole guide in one block, for the application workspace and the practice page.
export function ApplicationGuide({ guide, details, sample }: { guide: ApplicationGuideData; details: PublicDetails; sample: boolean }) {
  const empty = !guide.questions.length && !guide.documents.length && !guide.steps.length && !guide.routes.length
    && !guide.selection_stages.length && !guide.renewal_policies.length && !guide.obligations.length;
  return <div className="guide">
    {sample && <p className="guide-meta">Alles hier ist erfunden. Eine echte Bewerbung ist hier nicht möglich.</p>}
    {!guide.application_route_available && <p><strong>Der Bewerbungsweg des Anbieters ist gerade nicht offen.</strong> Nutz die Angaben, um dich vorzubereiten.</p>}
    {empty ? <p>Die Unterlagen und Schritte des Anbieters sind hier noch nicht verfügbar. Schau auf die offizielle Seite.</p> : <>
      <GuideSteps guide={guide} details={details} />
      <GuideDocuments guide={guide} details={details} />
      <GuideQuestions guide={guide} details={details} />
      <GuideAfter guide={guide} details={details} />
    </>}
  </div>;
}
