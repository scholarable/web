import { useState } from "react";
import { demoMode } from "../lib/demo-mode";
import { data, Link, useLoaderData } from "react-router";
import type { Route } from "./+types/scholarship-detail";
import { servingCall, servingCallGuide } from "../lib/serving.server";
import { ActivityCheck } from "../components/activity-check";
import { GuideAfter, GuideDocuments, GuideQuestions, GuideSteps, PartHint, showsAfter } from "../components/application-guide";
import { incomplete } from "../lib/application-guide";
import { SaveButton } from "../components/save-button";
import { FitCheck, StatusIcon, TrackSwitch } from "../components/fit-check";
import { BackIcon, ExternalIcon } from "../components/icons";
import { reportHref } from "../lib/reporting";
import type { PublicRequirement, PublicRuleGroup } from "../lib/public-details";
import { callFit, useAnswers } from "../lib/discovery-answers";
import { amountParts, availabilityDe, componentLabelDe, dateLong, dateShort, daysWord, deadlineWords, durationDe, levelsDe, monthLong, periodShort, routeTypeDe, scopeDe, sourceLabel, whenShort, windowTypeDe } from "../lib/copy-de";
import { requireStudentAuth, studentAuthEnv, studentAuthLoader, studentAuthReady, studentConnection } from "../lib/student-auth.server";
import { readStudentProgress } from "../lib/student-progress.server";

export const headers = () => ({ "Cache-Control": "no-store" });
export const meta = ({ data: loaded }: Route.MetaArgs) => [{ title: loaded && "scholarship" in loaded ? `${loaded.scholarship.title} | Scholarable` : "Stipendium | Scholarable" }];

export async function loader(args: Route.LoaderArgs) {
  const { params, request, context } = args;
  const env = (context as { cloudflare?: { env?: object } }).cloudflare?.env;
  const result = await servingCall(params.slug || "", env);
  if (result.state !== "ready") {
    return data({ ...result, guide: { state: "not_ready" as const }, studentAccounts: false, signedIn: false, saved: false, saveRequested: false },
      { status: result.state === "unavailable" ? 503 : 404 });
  }
  const guide = await servingCallGuide(result.scholarship.id, env);
  const base = { ...result, guide, studentAccounts: studentAuthReady(request, studentAuthEnv(context)), signedIn: false, saved: false,
    saveRequested: new URL(request.url).searchParams.get("save") === result.scholarship.id };
  if (!base.studentAccounts) return base;
  try {
    requireStudentAuth(request, studentAuthEnv(context));
    return await studentAuthLoader<typeof base>(args, async ({ auth, getAccessToken }) => {
      if (!auth.user?.emailVerified || auth.impersonator) return base;
      const token = getAccessToken();
      if (!token) return base;
      const { query, digest } = await studentConnection(context, auth.user.id, token);
      const progress = await readStudentProgress(query, digest);
      return { ...base, signedIn: true, saved: progress.opportunities.some(item => String(item.call_id) === result.scholarship.id && item.disposition === "saved") };
    });
  } catch { return base; }
}

const kindTag = { required: ["must", "Pflicht"], preferred: ["pref", "Wird bevorzugt"], exclusion: ["excl", "Ausschluss"], manual_review: ["note", "Hinweis"] } as const;
const groupLead = (group: PublicRuleGroup): string => {
  const combination = { all: "Alle diese Bedingungen", any: "Eine davon reicht", none: "Keine davon darf zutreffen" }[group.logic];
  return group.applies_to === "application" ? `${combination}:` : `${combination} (gilt für: ${group.applies_to.replaceAll("_", " ")}):`;
};
const SHOWN_RULES = 6;

export default function ScholarshipDetail() {
  const result = useLoaderData<typeof loader>();
  const answers = useAnswers();
  const tracks = result.state === "ready" ? result.scholarship.details.tracks : [];
  const [track, setTrack] = useState<string | null>(tracks[0]?.id ?? null);
  const [allRules, setAllRules] = useState(false);
  if (result.state === "unavailable") return <main className="detail"><section className="notice" role="status"><h1>Die Angaben sind gerade nicht erreichbar</h1><p>Wir konnten die Liste nicht abrufen. Bitte versuch es noch einmal.</p><a className="btn link" href="">Neu laden</a></section></main>;
  if (result.state !== "ready") return <main className="detail"><section className="notice"><h1>Dieses Stipendium ist nicht verfügbar</h1><p>Es erfüllt die Prüfregeln vielleicht nicht mehr.</p><Link className="btn link" to="/scholarships">Zu allen Stipendien</Link></section></main>;
  const { scholarship, guide, studentAccounts, signedIn, saved, saveRequested } = result;
  const { details, card, today } = scholarship;
  const { money, timing } = card;
  const trackId = tracks.length ? track : null;
  const inTrack = (id: string | null) => !tracks.length || !id || id === trackId;
  const steps = guide.state === "ready" ? guide.guide.steps.filter(step => inTrack(step.track_id)) : [];
  // A call that is not application-ready shows what was verified, part by part;
  // with no verified step, document or question there is one line instead.
  const bare = guide.state !== "ready" || (!guide.guide.application_ready && !guide.guide.steps.length
    && !guide.guide.documents.length && !guide.guide.questions.length);
  const trackLabel = (id: string | null) => id ? tracks.find(item => item.id === id)?.label.replace(/\s*\(.*$/, "") || "Bestimmte Gruppe" : null;
  const route = details.routes.find(item => item.availability_status === "available" && item.url && inTrack(item.track_id));
  const applyLabel = timing.sort <= 1 ? "Jetzt bewerben" : "Zur Bewerbung";
  const windows = details.windows.filter(item => item.window_type === "application" && inTrack(item.track_id))
    .sort((a, b) => (a.deadline_on || "9").localeCompare(b.deadline_on || "9"));
  const upcoming = windows.filter(item => !item.deadline_on || item.deadline_on >= today);
  const next = upcoming[0];
  const nextWords = deadlineWords(next);
  const otherWindows = details.windows.filter(item => item.window_type !== "application" && inTrack(item.track_id));
  const fit = answers.result ? callFit(answers.result, scholarship.id, card.levelRuleIds, tracks.length > 1 ? trackId : undefined) : null;
  const ruleStatus = (requirement: PublicRequirement): "ok" | "no" | "un" => {
    const best = fit?.best;
    if (!best) return "un";
    return best.criteria.matched.some(item => String(item.id) === requirement.id) ? "ok" : best.criteria.mismatched.some(item => String(item.id) === requirement.id) ? "no" : "un";
  };
  const rank = { no: 0, ok: 1, un: 2 };
  let shownRules = 0;
  const ruleList = (requirements: PublicRequirement[]) => {
    const list = requirements.filter(item => inTrack(item.track_id)).sort((a, b) => rank[ruleStatus(a)] - rank[ruleStatus(b)]);
    if (!list.length) return null;
    return <ul className="rules">{list.map(requirement => {
      const extra = shownRules++ >= SHOWN_RULES;
      const [tag, label] = kindTag[requirement.kind];
      return <li key={requirement.id} className={`rule${extra && !allRules ? " extra" : ""}`}><StatusIcon status={ruleStatus(requirement)} /><div className="txt"><span>{requirement.label}</span>
        <span className="tags"><span className={`tag ${tag}`}>{label}</span>{requirement.track_id && <span className="tag cond">{trackLabel(requirement.track_id)}</span>}</span></div></li>;
    })}</ul>;
  };
  const groupList = (group: PublicRuleGroup): React.ReactNode => !inTrack(group.track_id) ? null : <div className="rule-group" key={group.id}>
    <p className="group-lead">{groupLead(group)}{group.track_id && ` · ${trackLabel(group.track_id)}`}</p>
    {ruleList(group.requirements)}
    {group.groups.map(groupList)}
  </div>;
  const rules = <>{ruleList(details.eligibility.requirements)}{details.eligibility.groups.map(groupList)}</>;
  const totalRules = shownRules;
  const fundingGroups: [string | null | undefined, string][] = tracks.length > 1 ? [[null, "Für alle"], ...tracks.map(item => [item.id, item.label.replace(/\s*\(.*$/, "")] as [string, string])] : [[undefined, ""]];
  const benefit = (component: (typeof details.funding)[number]) => {
    const parts = amountParts(component);
    const tail = "text" in parts ? "" : [parts.unit, durationDe(component)].filter(Boolean).join(" ");
    return <li className="benefit" key={component.id}><div className="benefit-top"><b>{componentLabelDe(component.component_type)}</b>
      <span className="amt">{"text" in parts ? <small>{parts.text}</small> : <>{parts.pre && <small>{parts.pre} </small>}{parts.num}{tail && <small> {tail}</small>}</>}</span></div>
      {component.is_conditional && <span><span className="tag cond">wenn zutreffend</span></span>}<p>{component.description}</p></li>;
  };
  const durations = [...new Set(details.funding.filter(item => item.component_type === "living_stipend").map(durationDe).filter(Boolean))];
  const facts = [timing.label, timing.left !== null && timing.deadline ? `Frist ${dateShort(timing.deadline, today)}, noch ${daysWord(timing.left)}` : timing.opens || timing.deadline ? `Frist ${timing.deadlineEstimated ? "im " : ""}${whenShort(timing.deadline!, timing.deadlineEstimated, today)}` : "",
    ...card.audience, durations[0]?.replace(/^für /, "") || ""].filter(Boolean);
  const box = <div className="box" id="box">
    <div className="box-money">{"text" in money.head ? <span className="unit">{money.head.text}</span>
      : <>{money.head.pre && <span className="pre">{money.head.pre[0].toUpperCase() + money.head.pre.slice(1)}</span>}<span className="num">{money.head.num}</span><span className="unit">{[money.head.unit, money.note].filter(Boolean).join(", ")}</span></>}
      {money.plus && <span className="plus">{money.plus}</span>}{money.small && <span className="small">{money.small[0].toUpperCase() + money.small.slice(1)}</span>}</div>
    <div className="box-body">
      <div className="box-when"><span className={`pill ${timing.pill}`}>{timing.label}</span>
        <p><b>{next?.deadline_on && next.deadline_precision !== "rolling" ? `Frist ${nextWords.text}` : nextWords.text}</b>{timing.left !== null && <> · <span className={timing.pill === "urgent" ? "hot" : ""}>noch {daysWord(timing.left)}</span></>}</p>
        {nextWords.quiet && <p className="quiet">{nextWords.quiet}</p>}</div>
      <FitCheck callId={scholarship.id} levelRuleIds={card.levelRuleIds} tracks={tracks} track={trackId} onTrack={setTrack} scope={details.study_scope} />
      <div className="box-actions">{route && <a className="btn dark wide" href={route.url!} target="_blank" rel="noreferrer">{applyLabel} <ExternalIcon /></a>}
        <SaveButton callId={scholarship.id} slug={scholarship.slug} studentAccounts={studentAccounts} signedIn={signedIn} saved={saved} /></div>
      <p className="fine">Regelbasierter Abgleich mit den geprüften Angaben, keine Entscheidung über deine Berechtigung. Maßgeblich ist der Anbieter.</p>
    </div>
  </div>;
  return <main className="detail">
    <Link className="back" to="/scholarships"><BackIcon />Alle Stipendien</Link>
    <header className="d-head">{scholarship.provider && <p className="provider">{scholarship.provider}</p>}
      {/* data-build is the sample-page marker scripts/probe_demo_capacity.mjs looks for. */}
      {demoMode && <p className="kicker" data-build="Fictional sample opportunity">Erfundenes Beispiel</p>}
      <h1>{scholarship.title}</h1>
      <p className="factline">{facts.map(fact => <span key={fact} className={fact.startsWith("Frist") && timing.pill === "urgent" ? "hot" : undefined}>{fact}</span>)}</p></header>
    {scholarship.reviewOverdue && <p className="overdue-note" role="note">Zuletzt geprüft am {dateLong(scholarship.lastChecked) ?? "unbekannten Datum"}. Bitte prüfe die Angaben auf der Seite des Anbieters, bevor du dich bewirbst.</p>}
    {saveRequested && signedIn && !saved && <p className="notice" role="status">Du bist angemeldet. Merk dir dieses Stipendium mit einem Klick.</p>}
    <div className="d-grid">
      <aside className="d-aside">{box}</aside>
      <div className="d-main">
        <section className="sec" aria-labelledby="get-h"><h2 id="get-h">Was du bekommst</h2>
          {details.funding.length ? fundingGroups.map(([id, label]) => {
            const items = details.funding.filter(item => id === undefined || item.track_id === id);
            if (!items.length) return null;
            const priced = items.filter(item => item.amount_kind !== "in_kind"), kind = items.filter(item => item.amount_kind === "in_kind");
            return <div key={String(id)} className="benefit-group">{label && <p className="track-h">{label}</p>}
              {priced.length > 0 && <ul className="benefits">{priced.map(benefit)}</ul>}
              {kind.length > 0 && <details className="more"><summary>Dazu {kind.length} {kind.length === 1 ? "Angebot" : "Angebote"} ohne Geldbetrag</summary><ul className="benefits">{kind.map(benefit)}</ul></details>}</div>;
          }) : <p>{scholarship.fundingNotes || "Den Betrag findest du auf der Seite des Anbieters."}</p>}
        </section>

        <section className="sec" aria-labelledby="who-h"><h2 id="who-h">Kann ich mich bewerben?</h2>
          <dl className="scope"><dt>Studium</dt><dd>{levelsDe(card.levels).join(", ") || <span className="quiet-line">nicht angegeben</span>}</dd>
            <dt>Fächer</dt><dd>{scopeDe(details.study_scope.subjects, "subjects", scholarship.subjects)}</dd>
            <dt>Hochschulen</dt><dd>{scopeDe(details.study_scope.institutions, "universities", scholarship.institutions)}</dd></dl>
          <TrackSwitch tracks={tracks} track={trackId} onChange={setTrack} />
          <div className={`rules-wrap${allRules ? " open" : ""}`}>{rules}</div>
          {totalRules > SHOWN_RULES && <button type="button" className="btn link" aria-expanded={allRules} onClick={() => setAllRules(!allRules)}>{allRules ? "Weniger zeigen" : `Alle ${totalRules} Bedingungen zeigen`}</button>}
          {totalRules === 0 && !details.eligibility.has_unshown_requirements && <p>Hier stehen noch keine geprüften Bedingungen. Schau auf die offizielle Seite.</p>}
          {details.eligibility.has_unshown_requirements && <p>Manche Bedingungen konnten wir hier nicht zusammenfassen; sie stehen auf der offiziellen Seite. Der Abgleich prüft sie trotzdem.</p>}
          <p className="disclaimer">Das sind die geprüften Bedingungen des Anbieters, keine Entscheidung über deine Berechtigung. Maßgeblich ist die offizielle Seite.</p>
        </section>

        <section className="sec" aria-labelledby="apply-h"><h2 id="apply-h">So bewirbst du dich</h2>
          {route ? <p className="lead">Bewerbung über: <a href={route.url!} target="_blank" rel="noreferrer">{route.label} <ExternalIcon /></a></p>
            : details.routes.length > 0 && <ul className="route-list">{details.routes.filter(item => inTrack(item.track_id)).map(item => <li key={item.id}><strong>{item.label}</strong> ({routeTypeDe(item.route_type)}): {item.availability_status === "available" ? "den Link findest du auf der offiziellen Seite" : `${availabilityDe(item.availability_status)}, siehe offizielle Seite`}</li>)}</ul>}
          <ol className="timeline">
            {next?.opens_on && next.opens_on > today && <li><span className="dot key" /><b>Bewerbung öffnet {next.opens_precision === "estimated" ? `voraussichtlich im ${monthLong(next.opens_on)}` : `am ${dateLong(next.opens_on)}`}</b>{next.audience && <p>{next.audience}</p>}</li>}
            {steps.map((step, index) => <li key={step.id}><span className="dot">{index + 1}</span><b>{step.title}</b>{step.instructions && <p>{step.instructions}</p>}</li>)}
            {next ? <li><span className={`dot ${timing.pill === "urgent" ? "hot" : "key"}`} /><b>{next.deadline_on && next.deadline_precision !== "rolling" ? `Bewerbungsschluss: ${nextWords.text}` : nextWords.text}</b>
              {(nextWords.quiet || next.provider_text) && <p>{[nextWords.quiet, next.provider_text].filter(Boolean).join(" · ")}</p>}</li>
              : <li><span className="dot key" /><b>{windows.length ? "Die letzte Frist ist vorbei" : "Die Frist steht auf der Seite des Anbieters"}</b><p>Prüf beim Anbieter, wann die nächste Runde startet.</p></li>}
          </ol>
          {upcoming.length > 1 && <p className="quiet-line">Weitere Runden: {upcoming.slice(1).map(item => [deadlineWords(item).text, item.audience, trackLabel(item.track_id)].filter(Boolean).join(" · ")).join("; ")}</p>}
          {otherWindows.length > 0 && <p className="quiet-line">Weitere Termine: {otherWindows.map(item => `${windowTypeDe(item.window_type)}: ${deadlineWords(item).text}`).join("; ")}</p>}
          {guide.state === "ready" && !bare ? <>
            {incomplete(guide.guide, "application_steps") && <PartHint part="application_steps" shown={steps.length > 0} />}
            {demoMode && <p className="guide-meta">Alles hier ist erfunden. Eine echte Bewerbung ist hier nicht möglich.</p>}
            {!guide.guide.application_route_available && <p><strong>Der Bewerbungsweg des Anbieters ist gerade nicht offen.</strong> Nutz die Angaben, um dich vorzubereiten.</p>}
            {guide.guide.routes.length > 0 && <GuideSteps guide={{ ...guide.guide, steps: [] }} details={details} />}
            <GuideDocuments guide={guide.guide} details={details} />
            <GuideQuestions guide={guide.guide} details={details} />
          </> : <p className="quiet-line">{guide.state === "unavailable" ? "Unterlagen und Schritte sind gerade nicht erreichbar; nutz die offizielle Seite." : "Einzelne Schritte und Unterlagen haben wir noch nicht geprüft. Alles Nötige steht auf der Seite des Anbieters."}</p>}
        </section>

        {guide.state === "ready" && showsAfter(guide.guide)
          && <section className="sec" aria-labelledby="after-h"><h2 id="after-h">Nach der Bewerbung</h2><GuideAfter guide={guide.guide} details={details} /></section>}

        <ActivityCheck key={scholarship.id + scholarship.lastChecked} details={details} />

        <section className="sec" aria-labelledby="src-h"><h2 id="src-h">Quellen</h2>
          {details.sources.length ? <ul className="sources">{details.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{sourceLabel(source.url)} <ExternalIcon /></a></li>)}</ul> : <p>{demoMode ? "Erfundenes Beispiel, keine offizielle Quelle." : "Kein geprüfter Quellenlink vorhanden."}</p>}
          <p className="quiet-line">{scholarship.lastChecked ? `Zuletzt geprüft am ${dateLong(scholarship.lastChecked)}.` : "Prüfdatum nicht verfügbar."} Scholarable prüft die offiziellen Seiten; über deine Aufnahme entscheidet der Anbieter. <Link to={reportHref({ callId: scholarship.id, version: scholarship.lastChecked })}>Fehler oder veraltete Angabe melden</Link></p>
        </section>
      </div>
    </div>
    <div className="actionbar"><div className="ab-money">{"text" in money.head ? <b><small>Betrag beim Anbieter</small></b> : <b>{money.head.num}<small> {periodShort[money.head.unit] || money.head.unit}</small></b>}
      <span>{timing.opens ? `Öffnet ${timing.opensEstimated ? "im " : ""}${whenShort(timing.opens, timing.opensEstimated, today)}`
        : timing.deadline ? `Frist ${timing.deadlineEstimated ? "im " : ""}${whenShort(timing.deadline, timing.deadlineEstimated, today)}` : timing.label}</span></div>
      <SaveButton variant="icon" callId={scholarship.id} slug={scholarship.slug} studentAccounts={studentAccounts} signedIn={signedIn} saved={saved} />
      {route ? <a className="btn dark" href={route.url!} target="_blank" rel="noreferrer">{timing.sort <= 1 ? "Bewerben" : "Ansehen"} <ExternalIcon /></a> : <a className="btn dark" href="#fit">Passt es?</a>}</div>
  </main>;
}
