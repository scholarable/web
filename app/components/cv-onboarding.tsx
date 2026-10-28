import { useEffect, useRef, useState } from "react";
import type { CvCandidate } from "../lib/cv-import.server";
import { cvSuggestions, definedCvSuggestions, type CvSuggestions } from "../lib/cv-suggestions";

export type ConfirmedCvImport = { suggestions: CvSuggestions; candidates: CvCandidate[] };

const kindLabel: Record<CvCandidate["kind"], string> = {
  education: "Ausbildung", experience: "Erfahrung", project: "Projekt", volunteering: "Ehrenamt",
  award: "Auszeichnung", skill: "Fähigkeit", language: "Sprache",
};

export function correctCvCandidate(candidates: CvCandidate[], confirmed: string[], id: string, value: string) {
  return {
    candidates: candidates.map(candidate => candidate.id === id ? { ...candidate, originalValue: candidate.originalValue || candidate.value, value: value.slice(0, 240) } : candidate),
    confirmed: confirmed.filter(candidateId => candidateId !== id),
  };
}

export function removeCvCandidate(candidates: CvCandidate[], confirmed: string[], id: string) {
  return { candidates: candidates.filter(candidate => candidate.id !== id), confirmed: confirmed.filter(candidateId => candidateId !== id) };
}

export function CvOnboarding({ options, onApply }: {
  options: { institution: string[]; subject: string[] };
  onApply: (result: ConfirmedCvImport) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const [candidates, setCandidates] = useState<CvCandidate[]>([]);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  function clear() {
    pending.current?.abort(); pending.current = null;
    if (input.current) input.current.value = "";
    setCandidates([]); setConfirmed([]); setLoading(false); setError(null);
  }

  async function upload() {
    const file = input.current?.files?.[0];
    if (!file) { setError("Wähl zuerst einen Lebenslauf als PDF oder DOCX."); return; }
    const controller = new AbortController();
    pending.current?.abort(); pending.current = controller;
    setLoading(true); setError(null); setCandidates([]); setConfirmed([]);
    try {
      const form = new FormData(); form.set("cv", file);
      const response = await fetch("/api/cv-import", { method: "POST", body: form, signal: controller.signal, cache: "no-store" });
      const body = await response.json() as { candidates?: CvCandidate[]; error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok || !Array.isArray(body.candidates)) { setError(body.error || "Der Lebenslauf ließ sich nicht verarbeiten."); return; }
      setCandidates(body.candidates);
      if (!body.candidates.length) setError("Es wurden keine passenden Angaben gefunden. Du kannst sie stattdessen selbst eingeben.");
    } catch {
      if (!controller.signal.aborted) setError("Das Hochladen hat nicht geklappt. Versuch es noch einmal oder gib deine Angaben selbst ein.");
    } finally {
      if (input.current) input.current.value = "";
      if (pending.current === controller) { pending.current = null; setLoading(false); }
    }
  }

  function edit(id: string, value: string) {
    const corrected = correctCvCandidate(candidates, confirmed, id, value);
    setCandidates(corrected.candidates); setConfirmed(corrected.confirmed);
  }

  const accepted = candidates.filter(candidate => confirmed.includes(candidate.id) && candidate.value.trim());
  return <section className="cv-helper" aria-labelledby="cv-import-heading">
    <h3 id="cv-import-heading">Angaben aus dem Lebenslauf übernehmen</h3>
    <p>Freiwillig. Lade eine PDF- oder DOCX-Datei mit bis zu 4 MB hoch. Cloudflare verarbeitet sie in seinem weltweiten Netzwerk, um das Dokument umzuwandeln und genaue Auszüge aus dem Lebenslauf zum Prüfen vorzuschlagen. Eine Verarbeitung in einer bestimmten Region ist nicht garantiert.</p>
    <p>Die Originaldatei wird nur während dieser Anfrage verarbeitet und von Scholarable nicht gespeichert. Sie wird nach Erfolg, Fehler oder Abbruch freigegeben. Vorgeschlagene Angaben bleiben nur auf dieser Seite und verschwinden, wenn du die Seite verlässt, neu lädst, zurücksetzt oder nach 24 Stunden. Wenn du nach dem Abgleich „Angaben in meinem Konto speichern“ wählst, bleiben nur bestätigte Angaben bis zu 24 Stunden in diesem Tab, während du dich anmeldest; der Original-Lebenslauf wird nie aufbewahrt. Eine Lebenslauf-Datei für später zu speichern ist nicht möglich.</p>
    <p>Jeder Import nimmt höchstens 4.000 umgewandelte Tokens an und nutzt begrenzte Durchgänge zum Herauslesen und Prüfen bei Cloudflare, sodass die geschätzten Verarbeitungskosten unter 0,01 US-Dollar bleiben. Vorgeschlagen werden nur genaue Auszüge aus dem Lebenslauf zu Ausbildung, Erfahrung, Projekten, Ehrenamt, Auszeichnungen, Fähigkeiten und Sprachen. Prüf jeden Eintrag; sensible Merkmale werden nicht abgeleitet.</p>
    <label>Lebenslauf-Datei<input ref={input} type="file" name="cv" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={loading} /></label>
    <div className="cv-actions"><button type="button" onClick={upload} disabled={loading}>{loading ? "Lebenslauf wird gelesen …" : "Angaben finden"}</button><button type="button" onClick={clear}>{loading ? "Abbrechen und leeren" : "Import leeren"}</button></div>
    {loading && <p role="status">Die Datei wird geprüft und passende Angaben werden herausgelesen. Es wurde nichts gespeichert.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {!!candidates.length && <div className="cv-review" aria-labelledby="cv-review-heading"><h4 id="cv-review-heading">Bestätige oder entferne jeden Vorschlag</h4><p>Korrigiere einen Wert, bevor du ihn bestätigst. Wenn du einen bestätigten Wert änderst, ist er wieder unbestätigt.</p>
      {candidates.map(candidate => <article className="cv-candidate" key={candidate.id}>
        <p className="step-label">{kindLabel[candidate.kind]} · Quelle: hochgeladener Lebenslauf, {candidate.source.replace(/^line /, "Zeile ")}</p>
        <label>Vorgeschlagene Angabe<input value={candidate.value} maxLength={240} onChange={event => edit(candidate.id, event.target.value)} /></label>
        <div className="cv-candidate-actions"><label><input type="checkbox" checked={confirmed.includes(candidate.id)} onChange={event => setConfirmed(current => event.target.checked ? [...current, candidate.id] : current.filter(id => id !== candidate.id))} /> Diese Angabe bestätigen</label><button type="button" onClick={() => { const removed = removeCvCandidate(candidates, confirmed, candidate.id); setCandidates(removed.candidates); setConfirmed(removed.confirmed); }}>Entfernen</button></div>
      </article>)}
      <button type="button" disabled={!accepted.length} onClick={() => onApply({ candidates: accepted, suggestions: definedCvSuggestions(cvSuggestions(accepted.map(candidate => candidate.value).join("\n"), options)) })}>Bestätigte Angaben übernehmen</button>
    </div>}
  </section>;
}
