import { useEffect, useState } from "react";
import { callFit, readyToMatch, runMatch, setAnswers, useAnswers, type CallFit } from "../lib/discovery-answers";
import { levelName } from "../lib/copy-de";
import type { StudyScope } from "../lib/public-details";
import { CheckIcon, ChevronIcon, CrossIcon } from "./icons";

export function StatusIcon({ status }: { status: "ok" | "no" | "un" }) {
  return status === "ok" ? <span className="ic ok" aria-label="passt"><CheckIcon /></span>
    : status === "no" ? <span className="ic no" aria-label="passt nicht"><CrossIcon /></span>
    : <span className="ic un" aria-label="selbst prüfen">?</span>;
}

export function TrackSwitch({ tracks, track, onChange }: { tracks: { id: string; label: string }[]; track: string | null; onChange: (id: string) => void }) {
  if (tracks.length < 2) return null;
  return <div className="seg tracks" role="group" aria-label="Für welche Gruppe?">{tracks.map(item =>
    <button key={item.id} type="button" aria-pressed={item.id === track} onClick={() => onChange(item.id)}>{item.label.replace(/\s*\(.*$/, "")}</button>)}</div>;
}

// "Passt es zu dir?": the site's matching on this call's stored rules, with
// the student's answers from this tab. It compares rules; it never decides.
export function FitCheck({ callId, levelRuleIds, tracks, track, onTrack, scope }: {
  callId: string; levelRuleIds: string[]; tracks: { id: string; label: string }[]; track: string | null; onTrack: (id: string) => void;
  scope: { subjects: StudyScope; institutions: StudyScope };
}) {
  const answers = useAnswers();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setReady(true), []);
  const level = answers.facts.degree_level || "";
  const fit: CallFit | null = answers.result ? callFit(answers.result, callId, levelRuleIds, tracks.length > 1 ? track : undefined) : null;
  function change(field: "degree_level" | "adult", value: string) {
    if (field === "adult") setAnswers({ adult: value === "yes" ? "yes" : value === "no" ? "no" : null, asked: value ? ["adult"] : [] });
    else setAnswers({ facts: { degree_level: value }, asked: ["degree_level"] });
    setOpen(true);
    if (readyToMatch({ facts: { ...answers.facts, ...(field === "degree_level" ? { degree_level: value } : {}) }, adult: field === "adult" ? (value === "yes" ? "yes" : null) : answers.adult })) void runMatch();
  }
  const summary = answers.adult === "no" ? "Der Abgleich ist vorerst nur für Volljährige."
    : !readyToMatch(answers) ? "Zwei Angaben, dann prüfe ich die Regeln."
    : answers.loading ? "Ich gleiche ab …"
    : !fit ? "Für dieses Stipendium gibt es gerade keinen Abgleich."
    : fit.conflict ? "Passt laut Regeln nicht zu deinen Angaben."
    : [fit.level === "ok" ? "Dein Studium passt" : "", fit.unknown ? `${fit.unknown} ${fit.unknown === 1 ? "Punkt" : "Punkte"} selbst prüfen` : "Keine offenen Punkte laut Regeln"].filter(Boolean).join(" · ");
  const rows: [("ok" | "no" | "un"), string, string][] = fit ? [
    fit.level === "ok" ? ["ok", "Studienniveau passt", `Die Regeln nennen ${levelName(level)}.`]
      : fit.level === "no" ? ["no", "Studienniveau passt nicht", `Die Regeln schließen ${levelName(level)} aus.`]
      : fit.level === "un" ? ["un", "Studienniveau je nach Gruppe", "Wähl oben deine Gruppe."]
      : ["un", "Studienniveau nicht angegeben", "Bitte auf der Seite des Anbieters prüfen."],
    scope.subjects === "all" ? ["ok", "Fach: alle Fächer", "Sagt der Anbieter."] : ["un", "Fach: selbst prüfen", scope.subjects === "selected" ? "Nur bestimmte Fächer." : "Der Anbieter nennt keine Fächer."],
    scope.institutions === "all" ? ["ok", "Hochschule: alle staatlich anerkannten", "Sagt der Anbieter."] : ["un", "Hochschule: selbst prüfen", scope.institutions === "selected" ? "Nur bestimmte Hochschulen." : "Der Anbieter nennt keine Hochschulen."],
  ] : [];
  return <section className={`fitp${open ? " open" : ""}`} id="fit" aria-labelledby="fit-h">
    <button type="button" className="fit-sum" aria-expanded={open} aria-controls="fit-body" onClick={() => setOpen(!open)}>
      <span className="fit-t"><b id="fit-h">Passt es zu dir?</b><span>{summary}</span></span><span className="chev"><ChevronIcon open={open} /></span></button>
    <div className="fit-body" id="fit-body">
      <TrackSwitch tracks={tracks} track={track} onChange={onTrack} />
      <div className="fit-fields">
        <label>Studium<select value={level} disabled={!ready} onChange={event => change("degree_level", event.target.value)}>
          <option value="">Weiß ich noch nicht</option><option value="bachelor">Bachelor</option><option value="master">Master</option><option value="doctoral">Promotion</option></select></label>
        {answers.adult !== "yes" && <label>18 oder älter?<select value={answers.adult || ""} disabled={!ready} onChange={event => change("adult", event.target.value)}>
          <option value="">Bitte wählen</option><option value="yes">Ja</option><option value="no">Nein</option></select></label>}
      </div>
      {fit && <ul className="fit-res">
        {fit.conflict && fit.conflictLabel && <li><StatusIcon status="no" /><span>Passt laut Regel nicht<span className="why">{fit.conflictLabel}</span></span></li>}
        {rows.map(([status, title, why]) => <li key={title}><StatusIcon status={status} /><span>{title}<span className="why">{why}</span></span></li>)}
        {fit.unknown > 0 && <li><StatusIcon status="un" /><span>{fit.unknown} weitere {fit.unknown === 1 ? "Punkt" : "Punkte"} selbst prüfen<span className="why">Liste unter „Kann ich mich bewerben?“</span></span></li>}
      </ul>}
      {answers.error && <p className="form-error" role="alert">{answers.error}</p>}
      <p className="fine">Deine Angaben bleiben nur in diesem Tab. Sie gehen erst an den Abgleich, wenn du Studium und Alter angegeben hast.</p>
    </div>
  </section>;
}
