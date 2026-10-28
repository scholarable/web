import { useEffect, useRef, useState } from "react";
import { demoMode, publicDemoMode } from "../lib/demo-mode";
import type { DiscoveryFacts } from "../lib/discovery";
import { interpretAge, interpretGoal, mergeDiscoveryFacts } from "../lib/discovery";
import { getAnswers, matchRequest, propose, readyToMatch, resetAnswers, runMatch, say, setAnswers, useAnswers, type AnswerField, type AnswersState } from "../lib/discovery-answers";
import { confirmedDiscoveryContext, contextStorageKey, type CvFactSources } from "../lib/discovery-context";
import type { ScholarshipListItem } from "../lib/serving.server";
import type { CvCandidate } from "../lib/cv-import.server";
import { cvSuggestions, type CvSuggestions } from "../lib/cv-suggestions";
import { levelName } from "../lib/copy-de";
import { NOT_LISTED, universityChoices, universityFit, type SubjectInfo } from "../lib/study-fit";
import { arrangeList, families, familyTitle, ownCall } from "./scholarship-list";
import { CvOnboarding, type ConfirmedCvImport } from "./cv-onboarding";
import { DownIcon, EditIcon, LogoMark, SendIcon } from "./icons";
import { HeroFigures, HeroFiguresRow } from "./hero-figures";

// subjectInfo: a taxonomy subject's German name and Fächergruppe (profileOptions).
type Options = { state: "ready" | "unavailable"; institution: string[]; subject: string[]; subjectInfo?: SubjectInfo; usesStudyPlan: boolean };
type Question = { field: AnswerField; text: string; chips: [string, string][] };
const plans: [string, string][] = [["exchange", "Auslandsaufenthalt"], ["internship", "Praktikum"], ["thesis", "Abschlussarbeit"], ["graduation", "Abschluss"]];
const humanize = (value: string) => value.replaceAll("_", " ");
const subjectName = (value: string, options: Pick<Options, "subjectInfo">) => options.subjectInfo?.[value]?.label ?? humanize(value);
// The answers after the choices: the student's own is not among them, or not decided yet.
const notListed = { subject: [NOT_LISTED, "Mein Fach ist nicht dabei"] as [string, string], institution: [NOT_LISTED, "Meine Hochschule ist nicht dabei"] as [string, string] };
const open: [string, string] = ["", "Noch offen"];
const fieldWords: Record<AnswerField, string> = { degree_level: "Studium", adult: "18 oder älter", subject: "Fach", institution: "Hochschule", semester_number: "Fachsemester", future_plan: "Vorhaben" };

export function recordDiscoveryEvent(event: string, elapsedMs?: number) {
  const body = JSON.stringify({ event, ...(elapsedMs === undefined ? {} : { elapsedMs }) });
  void fetch("/api/discovery-events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
}
// A changed answer counts once per question, and only when it replaces an earlier one.
export function markCorrection(seen: Set<string>, field: string, before: string, after: string): boolean {
  if (!before || before === after || seen.has(field)) return false;
  seen.add(field);
  return true;
}

// The questions the catalogue can use, in order. Subject and university are
// asked only when listed calls name some (taxonomy subjects, specific
// universities or rule values); semester and plans only when a result needs
// them or the catalogue uses them.
export function questions(options: Options, answers: Pick<AnswersState, "result">): Question[] {
  const list: Question[] = [
    { field: "degree_level", text: "Was studierst du gerade, oder was hast du vor?", chips: [["bachelor", "Bachelor"], ["master", "Master"], ["doctoral", "Promotion"], ["", "Weiß ich noch nicht"]] },
    { field: "adult", text: "Kurze Frage: Bist du 18 oder älter? Scholarable ist vorerst nur für Volljährige. Ich merke mir nur Ja oder Nein, nicht dein Alter.", chips: [["yes", "Ja, 18 oder älter"], ["no", "Nein"]] },
  ];
  if (options.subject.length) list.push({ field: "subject", text: "Welches Fach studierst du?", chips: [...options.subject.slice(0, 8).map(value => [value, subjectName(value, options)] as [string, string]), notListed.subject, open] });
  if (options.institution.length) list.push({ field: "institution", text: "Wo studierst du, oder wo willst du hin?", chips: [...options.institution.slice(0, 8).map(value => [value, value] as [string, string]), notListed.institution, open] });
  const followUps = answers.result?.followUps?.map(item => item.field) || [];
  if (followUps.includes("semester_number")) list.push({ field: "semester_number", text: "In welchem Fachsemester bist du?", chips: [...Array.from({ length: 8 }, (_, i) => [String(i + 1), String(i + 1)] as [string, string]), ["", "Noch nicht angefangen"]] });
  if (options.usesStudyPlan || followUps.includes("milestone")) list.push({ field: "future_plan", text: "Hast du bald etwas davon vor?", chips: [...plans, ["", "Nichts davon"]] });
  return list;
}
export function nextQuestion(options: Options, answers: Pick<AnswersState, "result" | "asked" | "adult">): Question | null {
  if (answers.adult === "no") return null;
  return questions(options, answers).find(question => !answers.asked.includes(question.field)) || null;
}
const answerLabel = (field: AnswerField, value: string, options: Options) => {
  if (field === "adult") return value === "yes" ? "18+" : "Unter 18";
  if (field === "degree_level") return levelName(value);
  if (field === "future_plan") return plans.find(([key]) => key === value)?.[1] || value;
  if (field === "semester_number") return `${value}. Semester`;
  if (value === NOT_LISTED) return field === "subject" ? "Fach nicht dabei" : "Hochschule nicht dabei";
  if (field === "subject") return subjectName(value, options);
  return value;
};
// The subjects by Fächergruppe (Destatis): each group's subjects A to Z, then
// the group itself for any other subject in it; rule values without a
// taxonomy name come last.
export function subjectOptions(options: Pick<Options, "subject" | "subjectInfo">) {
  const info = options.subjectInfo || {};
  const byName = (a: string, b: string) => subjectName(a, options).localeCompare(subjectName(b, options), "de");
  const groups = options.subject.filter(value => info[value] && info[value].group === null).sort(byName);
  const rest = options.subject.filter(value => !info[value] || (info[value].group !== null && !groups.includes(info[value].group!)));
  return <>
    {groups.map(group => <optgroup key={group} label={subjectName(group, options)}>
      {options.subject.filter(value => info[value]?.group === group).sort(byName).map(value => <option key={value} value={value}>{subjectName(value, options)}</option>)}
      <option value={group}>Anderes Fach aus dieser Gruppe</option>
    </optgroup>)}
    {rest.length > 0 && <optgroup label="Weitere">{rest.sort(byName).map(value => <option key={value} value={value}>{subjectName(value, options)}</option>)}</optgroup>}
  </>;
}
// "a, b und c"
const listDe = (parts: string[]) => parts.length > 1 ? `${parts.slice(0, -1).join(", ")} und ${parts.at(-1)}` : parts[0] || "";

// What the list now shows, in words: counts only, from the published rules,
// over every listed call, counted the way the list shows them (a family's
// grouped card once).
export function resultSummary(items: ScholarshipListItem[], answers: AnswersState): string {
  if (!answers.result || !answers.facts.degree_level) return "";
  const level = levelName(answers.facts.degree_level);
  const list = arrangeList(items, answers.result, { institution: answers.facts.institution || null, subject: answers.facts.subject || null });
  const named = list.shown.length, rest = list.unstated.length;
  const folded = [
    list.otherUniversity.length ? `${list.otherUniversity.length} nur für Studierende anderer Hochschulen` : "",
    list.otherSubject.length ? `${list.otherSubject.length} nur für andere Fächer` : "",
    list.conflicts.length ? `${list.conflicts.length} ${list.conflicts.length === 1 ? "passt" : "passen"} laut Regeln nicht` : "",
  ].filter(Boolean);
  return [
    named ? `${named} ${named === 1 ? "Stipendium nennt" : "Stipendien nennen"} ${level} ausdrücklich, ${named === 1 ? "es steht" : "sie stehen"} jetzt oben.`
      : `Kein Stipendium nennt ${level} so, dass ich es prüfen kann.`,
    rest ? `Bei ${rest} steht kein Studienniveau, ${rest === 1 ? "es kommt" : "sie kommen"} danach.` : "",
    folded.length ? `Ganz unten eingeklappt: ${listDe(folded)}.` : "",
  ].filter(Boolean).join(" ");
}

// What the list does with the university answer: a declared family
// (Deutschlandstipendium) puts the student's own university's call in the
// list and folds the other universities away; without a call of the student's
// university it says so and folds the grouped card away. When a university
// could be listed under another name, the grouped card stays and the student
// picks. No families listed: nothing to say.
export function institutionNote(items: ScholarshipListItem[], institution: string): string | null {
  const listed = families(items);
  if (!listed.size) return null;
  const names = (keys: string[]) => keys.map(key => `das ${familyTitle(key)}`).join(" und ");
  if (!institution.trim()) { const all = names([...listed.keys()]); return `Okay. ${all[0].toUpperCase()}${all.slice(1)} zeige ich dir dann als Übersicht aller Hochschulen in der Liste.`; }
  const found = [...listed].filter(([, members]) => ownCall(members, institution)).map(([key]) => key);
  if (found.length) return `Für ${institution.trim()} steht ${names(found)} deiner Hochschule jetzt in der Liste. Die anderen Hochschulen stehen ganz unten, eingeklappt.`;
  const known = universityChoices(items);
  const unsure = [...listed].filter(([, members]) => members.some(member => universityFit({ ...member, scope: member.card.study.institutions }, institution, known) !== "other")).map(([key]) => key);
  if (unsure.length) return `Ob deine Hochschule beim ${unsure.map(familyTitle).join(" und ")} dabei ist, kann ich nicht sicher sagen. Wähl sie in der Übersicht in der Liste.`;
  return `Für deine Hochschule haben wir ${names([...listed.keys()])} noch nicht geprüft. Die anderen Hochschulen stehen ganz unten, eingeklappt.`;
}

// Typed text goes to /api/chat only when chat reading is switched on; any
// failure, limit or timeout falls back to the reader in this browser.
async function askChatAi(text: string): Promise<{ facts: DiscoveryFacts; adult: "yes" | "no" | null } | null> {
  try {
    const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
      cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const data = await response.json();
    return data && typeof data === "object" && data.facts && typeof data.facts === "object" ? data : null;
  } catch { return null; }
}

export function DiscoveryChat({ options, items, total = items.length, studentAccounts, cvImport, chatAi = false, initialFacts, adultConfirmed, manualEntry }: {
  options: Options; items: ScholarshipListItem[]; total?: number; studentAccounts: boolean; cvImport: boolean; chatAi?: boolean;
  initialFacts: DiscoveryFacts; adultConfirmed: boolean; manualEntry: boolean;
}) {
  const answers = useAnswers();
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [logOpen, setLogOpen] = useState(false);
  const [showCv, setShowCv] = useState(false);
  const [cvCandidates, setCvCandidates] = useState<CvCandidate[]>([]);
  const [cvSources, setCvSources] = useState<CvFactSources>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const startedAt = useRef<number | null>(null);
  const reached = useRef(false);
  const corrected = useRef(new Set<string>());
  const previous = useRef<DiscoveryFacts>({});
  const started = answers.chat.length > 0 || answers.asked.length > 0;

  useEffect(() => {
    setReady(true);
    // A signed-in student's saved answers seed the chat once, in this tab only.
    if (!started && (Object.values(initialFacts).some(Boolean) || adultConfirmed)) {
      setAnswers({ facts: initialFacts, adult: adultConfirmed ? "yes" : null,
        asked: [...Object.entries(initialFacts).filter(([, value]) => value).map(([field]) => field as AnswerField), ...(adultConfirmed ? ["adult" as const] : [])] });
      say({ who: "bot", text: "Willkommen zurück. Ich habe deine gespeicherten Angaben übernommen; tipp oben auf eine, um sie zu ändern." });
      if (readyToMatch(getAnswers())) void match(getAnswers().facts); else askNext();
    }
    const leave = () => { if (startedAt.current !== null && !reached.current) recordDiscoveryEvent("abandonment", Date.now() - startedAt.current); };
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, []);

  function begin() { if (startedAt.current === null) startedAt.current = Date.now(); }
  async function match(after: DiscoveryFacts) {
    if (!readyToMatch({ facts: after, adult: getAnswers().adult })) return;
    const result = await runMatch();
    if (!result) return;
    if (!reached.current) { reached.current = true; recordDiscoveryEvent("first_result", startedAt.current === null ? 0 : Date.now() - startedAt.current); }
    const summary = resultSummary(items, getAnswers());
    if (summary) say({ who: "bot", text: summary });
    askNext();
  }
  function askNext() {
    const snapshot = getAnswers();
    const question = nextQuestion(options, snapshot);
    if (question) say({ who: "bot", text: question.text });
    else if (snapshot.adult === "yes") say({ who: "bot", text: "Fertig! Was laut den geprüften Regeln zu dir passt, steht in der Liste ganz oben. Den Rest prüfst du auf der Stipendienseite, dort zeige ich dir genau, was." });
  }
  function track(field: AnswerField, value: string) {
    if (field === "adult") return;
    if (markCorrection(corrected.current, field, previous.current[field] || "", value)) recordDiscoveryEvent("correction");
    previous.current = { ...previous.current, [field]: value };
  }
  function choose(field: AnswerField, value: string, label: string) {
    begin();
    if (!answers.chat.length) say({ who: "bot", text: questions(options, answers)[0].text });
    say({ who: "me", text: label });
    track(field, value);
    if (field === "adult") {
      setAnswers({ adult: value === "yes" ? "yes" : "no", asked: ["adult"] });
      if (value !== "yes") { say({ who: "bot", text: "Okay. Dann kann ich die Liste noch nicht für dich sortieren. Ansehen kannst du alle Stipendien trotzdem, mit Beträgen, Fristen und Bedingungen." }); return; }
    } else setAnswers({ facts: { [field]: value }, asked: [field] });
    if (field === "degree_level" && !value) say({ who: "bot", text: "Kein Problem. Dann bleibt die Liste nach Frist sortiert." });
    if (field === "institution") { const note = institutionNote(items, value); if (note) say({ who: "bot", text: note }); }
    const after = getAnswers();
    if (readyToMatch(after)) void match(after.facts); else askNext();
  }
  function edit(field: AnswerField) {
    setAnswers({ forget: [field] });
    const question = questions(options, getAnswers()).find(item => item.field === field);
    if (question) say({ who: "bot", text: question.text });
  }
  async function read(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = text.trim();
    if (!ready || !typed || thinking) return;
    begin(); setText("");
    if (!answers.chat.length) say({ who: "bot", text: questions(options, answers)[0].text });
    say({ who: "me", text: typed });
    let reading = interpretGoal(typed, options);
    let adult = interpretAge(typed);
    if (chatAi) {
      setThinking(true);
      const understood = await askChatAi(typed);
      setThinking(false);
      if (understood && (Object.keys(understood.facts).length || understood.adult)) {
        reading = { ...reading, facts: understood.facts, conflictField: undefined };
        adult = understood.adult ?? adult;
      }
    }
    if (reading.conflictField && !Object.keys(reading.facts).length) {
      recordDiscoveryEvent("clarification");
      const question = questions(options, answers).find(item => item.field === reading.conflictField);
      say({ who: "bot", text: `Du hast mehr als eine Angabe für „${fieldWords[reading.conflictField]}“ genannt. Welche stimmt?` });
      if (question) setAnswers({ forget: [question.field] });
      return;
    }
    if (!Object.keys(reading.facts).length && !adult) {
      recordDiscoveryEvent("clarification");
      say({ who: "bot", text: "Das konnte ich nicht zuordnen. Tipp einfach eine Antwort an oder schreib es anders, zum Beispiel „Master, 3. Semester“." });
      return;
    }
    say({ who: "bot", text: "Hab ich das richtig verstanden?" });
    propose({ facts: reading.facts, adult });
  }
  function confirm(yes: boolean) {
    const proposal = answers.proposal;
    if (!proposal) return;
    say({ who: "me", text: yes ? "Ja, stimmt" : "Nein, ändern" });
    if (!yes) { propose(null); say({ who: "bot", text: "Okay, dann tipp die Antwort lieber an." }); askNext(); return; }
    for (const [field, value] of Object.entries(proposal.facts)) track(field as AnswerField, value || "");
    setAnswers({ facts: proposal.facts, ...(proposal.adult ? { adult: proposal.adult } : {}),
      asked: [...Object.keys(proposal.facts) as AnswerField[], ...(proposal.adult ? ["adult" as const] : [])] });
    if (proposal.adult === "no") { say({ who: "bot", text: "Okay. Dann kann ich die Liste noch nicht für dich sortieren. Ansehen kannst du alle Stipendien trotzdem." }); return; }
    if (proposal.facts.institution) { const note = institutionNote(items, proposal.facts.institution); if (note) say({ who: "bot", text: note }); }
    const after = getAnswers();
    if (readyToMatch(after)) void match(after.facts); else askNext();
  }
  function useCv(imported: ConfirmedCvImport) {
    const merged = mergeDiscoveryFacts(answers.facts, imported.suggestions);
    setCvSources(current => ({ ...current, ...Object.fromEntries(Object.entries(imported.suggestions).filter(([field]) => !answers.facts[field as keyof DiscoveryFacts]).map(([field, value]) => {
      const evidence = imported.candidates.find(candidate => cvSuggestions(candidate.value, options)[field as keyof CvSuggestions] === value);
      return [field, { value: String(value), reference: evidence?.source || `study ${field}`, excerpt: evidence?.originalValue || evidence?.value || String(value) }];
    })) }));
    setCvCandidates(current => [...current, ...imported.candidates.filter(candidate => !current.some(existing => existing.kind === candidate.kind && existing.value === candidate.value))]);
    setShowCv(false);
    const fresh = Object.fromEntries(Object.entries(imported.suggestions).filter(([field, value]) => value && !answers.facts[field as keyof DiscoveryFacts])) as DiscoveryFacts;
    if (merged.conflicts.length) say({ who: "bot", text: "Dein Lebenslauf weicht von deinen Antworten ab. Deine Antworten bleiben, bitte prüf beides." });
    if (!Object.keys(fresh).length) { say({ who: "bot", text: "Im Lebenslauf habe ich keine neuen Angaben zum Studium gefunden, die ich abgleichen kann." }); return; }
    say({ who: "bot", text: "Das habe ich in deinem Lebenslauf gelesen. Stimmt das?" });
    propose({ facts: fresh, adult: null });
  }
  function saveContext() {
    if (!answers.result) return;
    const context = confirmedDiscoveryContext(matchRequest(answers.facts).profile, cvCandidates, cvSources);
    const serialized = JSON.stringify(context);
    if (context.items.length > 60 || serialized.length > 64000) { setSaveError("Das ist zu viel auf einmal. Entferne ein paar übernommene Angaben und versuch es noch einmal."); return; }
    try { window.sessionStorage.setItem(contextStorageKey, serialized); window.location.assign("/profile"); }
    catch { setSaveError("Dieser Browser konnte deine Angaben für die Anmeldung nicht behalten. Bleib auf dieser Seite und versuch es noch einmal."); }
  }
  function useSample() {
    begin();
    say({ who: "bot", text: questions(options, answers)[0].text }, { who: "me", text: "Beispielangaben nutzen" },
      { who: "bot", text: "Ich habe Bachelor, computer science, 3. Semester an der Example University eingetragen. Dein Alter bestätigst du selbst." });
    setAnswers({ facts: { degree_level: "bachelor", subject: "computer_science", institution: "Example University", semester_number: "3" }, asked: ["degree_level", "subject", "institution", "semester_number"] });
    askNext();
  }

  const question = !answers.proposal ? nextQuestion(options, answers) : null;
  const given = (["degree_level", "adult", "subject", "institution", "semester_number", "future_plan"] as AnswerField[])
    .filter(field => field === "adult" ? answers.adult : answers.facts[field as keyof DiscoveryFacts]);
  const composer = (big: boolean, placeholder: string) => <form className={`composer${big ? " big" : ""}`} method="post" action="/match" onSubmit={read} autoComplete="off">
    <label htmlFor="scholarship-goal" className="sr-only">Nachricht an Scholarable</label>
    <input id="scholarship-goal" value={text} onChange={event => setText(event.target.value)} maxLength={1000} placeholder={placeholder} aria-describedby="goal-privacy" />
    <button className="send" aria-label="Senden" disabled={!ready || !text.trim() || thinking}><SendIcon /></button>
  </form>;
  const privacy = <p className="fine" id="goal-privacy">{chatAi
    ? "Was du tippst, liest eine KI bei Cloudflare, nur um deine Antworten zu erkennen; gespeichert wird nichts. Bitte keine Namen oder Kontaktdaten. Deine Antworten bleiben nur in diesem Tab und sind nach spätestens 24 Stunden weg."
    : "Bitte keine Namen oder Kontaktdaten. Deine Antworten bleiben nur in diesem Tab und sind nach spätestens 24 Stunden weg."}</p>;
  const chips = (list: [string, string][], field: AnswerField) => <div className="chips">{list.map(([value, label]) =>
    <button key={label} type="button" className="chip" disabled={!ready} onClick={() => choose(field, value, label)}>{label}</button>)}</div>;
  // Many universities or subjects are a list to pick from, not eight taps;
  // "nicht dabei" and "noch offen" stay one tap each.
  const picker = (field: "institution" | "subject", placeholder: string, choicesList: React.ReactNode) => <form className="pick-uni chat" onSubmit={event => {
      event.preventDefault(); const value = String(new FormData(event.currentTarget).get(field) || ""); if (value) choose(field, value, answerLabel(field, value, options)); }}>
    <label htmlFor={`chat-${field}`} className="sr-only">{fieldWords[field]}</label>
    <select id={`chat-${field}`} name={field} defaultValue="" disabled={!ready}><option value="">{placeholder}</option>{choicesList}</select>
    <button className="chip" disabled={!ready}>Übernehmen</button>
    {[notListed[field], open].map(([value, label]) => <button key={label} type="button" className="chip" disabled={!ready} onClick={() => choose(field, value, label)}>{label}</button>)}
  </form>;
  const answerField = (question: Question) => question.field === "institution" && options.institution.length > 8
    ? picker("institution", "Hochschule auswählen …", options.institution.map(value => <option key={value} value={value}>{value}</option>))
    : question.field === "subject" && options.subject.length > 8 ? picker("subject", "Fach auswählen …", subjectOptions(options))
    : chips(question.chips, question.field);
  const sample = publicDemoMode && <div className="sample-help"><p>Zum Ausprobieren: Bachelor, computer science, 3. Semester an der Example University.</p>
    <button type="button" className="chip" disabled={!ready} onClick={useSample}>Beispielangaben nutzen</button></div>;
  const cv = cvImport && <>
    {!showCv && <button type="button" className="btn link" onClick={() => setShowCv(true)}>Lebenslauf hochladen</button>}
    {showCv && <div className="cv-panel"><CvOnboarding options={options} onApply={useCv} /></div>}
  </>;

  if (manualEntry) return <ShortForm options={options} ready={ready} onDone={facts => { begin(); setAnswers({ facts: facts.facts, adult: facts.adult, asked: ["degree_level", "adult", "subject", "institution", "semester_number", "future_plan"] }); void match(facts.facts); }} />;

  if (!started) return <section className="hero start" aria-labelledby="hero-h"><HeroFigures /><div className="hero-in">
    <h1 id="hero-h">Finde dein <em>Stipendium.</em></h1>
    <p className="sub">{total ? `${total} geprüfte Stipendien für dein Studium in Deutschland. ` : ""}Sag mir kurz, was du studierst, und ich sortiere sie für dich.</p>
    {composer(true, "Was studierst du?")}
    {chips(questions(options, answers)[0].chips, "degree_level")}
    {privacy}
    {sample}{cv}
    <noscript><p className="fine">Für den Chat brauchst du JavaScript. Die Liste unten funktioniert auch ohne.</p></noscript>
    <a className="jump" href="#list">{total ? `Alle ${total} ansehen` : "Zur Liste"} <DownIcon /></a>
    <HeroFiguresRow />
  </div></section>;

  const shown = logOpen ? answers.chat : answers.chat.slice(-3);
  return <section className="hero thread-mode" aria-label="Chat mit Scholarable"><div className="hero-in">
    <h1 className="sr-only">Stipendien finden</h1>
    {given.length > 0 && <div className="answers" aria-label="Deine Angaben">{given.map(field => {
      const value = field === "adult" ? answers.adult! : answers.facts[field as keyof DiscoveryFacts]!;
      return <button key={field} type="button" className="answer" disabled={!ready} aria-label={`${fieldWords[field]}: ${answerLabel(field, value, options)}, ändern`} onClick={() => edit(field)}>
        <span>{answerLabel(field, value, options)}</span><EditIcon /></button>;
    })}</div>}
    <div className="chat-tools">{answers.chat.length > 3 ? <button type="button" className="btn link" onClick={() => setLogOpen(!logOpen)}>{logOpen ? "Weniger anzeigen" : "Verlauf zeigen"}</button> : <span />}
      <button type="button" className="btn link" onClick={() => { resetAnswers(); setCvCandidates([]); setCvSources({}); corrected.current.clear(); previous.current = {}; startedAt.current = null; reached.current = false; }}>Neu starten</button></div>
    <div className="thread" role="log" aria-live="polite">{shown.map((message, index) => message.who === "bot"
      ? <div className="msg bot" key={index}><LogoMark /><p>{message.text}</p></div>
      : <p className="msg me" key={index}>{message.text}</p>)}
      {answers.proposal && <div className="proposal"><dl>{Object.entries(answers.proposal.facts).map(([field, value]) => <div key={field}><dt>{fieldWords[field as AnswerField]}</dt><dd>{answerLabel(field as AnswerField, value || "", options)}</dd></div>)}
        {answers.proposal.adult && <div><dt>18 oder älter</dt><dd>{answers.proposal.adult === "yes" ? "Ja" : "Nein"}</dd></div>}</dl></div>}
      {thinking && <div className="msg bot"><LogoMark /><p role="status">Ich lese deine Nachricht …</p></div>}
      {answers.loading && <div className="msg bot"><LogoMark /><p role="status">Ich gleiche deine Angaben mit den geprüften Regeln ab …</p></div>}
      {answers.error && <p className="form-error" role="alert">{answers.error}</p>}
    </div>
    {answers.proposal ? <div className="chips"><button type="button" className="chip" onClick={() => confirm(true)}>Ja, stimmt</button><button type="button" className="chip" onClick={() => confirm(false)}>Nein, ändern</button></div>
      : question && answerField(question)}
    {composer(false, question ? "Oder schreib hier …" : "Noch was ändern?")}
    {privacy}
    {cv}
    {studentAccounts && answers.result && <div className="chat-save"><button type="button" className="btn hero-line sm" onClick={saveContext}>Angaben in meinem Konto speichern</button>
      {saveError && <p className="form-error" role="alert">{saveError}</p>}</div>}
  </div></section>;
}

function ShortForm({ options, ready, onDone }: { options: Options; ready: boolean; onDone: (answers: { facts: DiscoveryFacts; adult: "yes" }) => void }) {
  const answers = useAnswers();
  const [error, setError] = useState<string | null>(null);
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!form.get("adult")) { setError("Bitte beantworte die Altersfrage."); return; }
    if (form.get("adult") !== "yes") { setError("Scholarable ist vorerst nur für Volljährige. Ansehen kannst du alle Stipendien trotzdem."); return; }
    setError(null);
    const value = (name: string) => String(form.get(name) || "");
    onDone({ adult: "yes", facts: { degree_level: value("degree_level"), subject: value("subject"), institution: value("institution"), semester_number: value("semester_number"), future_plan: value("future_plan") } });
  }
  return <section className="hero thread-mode" aria-labelledby="form-h"><div className="hero-in">
    <h1 id="form-h" className="form-title">Deine Angaben</h1>
    <p className="sub">Alles, was du nicht weißt, bleibt leer. Nichts wird gespeichert.</p>
    <form className="short-form" method="post" action="/api/matches" autoComplete="off" onSubmit={submit}>
      <fieldset className="age-confirmation"><legend>Bist du 18 oder älter?</legend>
        <label><input type="radio" name="adult" value="yes" required /> Ja</label><label><input type="radio" name="adult" value="no" /> Nein</label></fieldset>
      <label>Studium<select name="degree_level" defaultValue={answers.facts.degree_level || ""}><option value="">Weiß ich nicht</option><option value="prefer_not_to_say">Möchte ich nicht sagen</option><option value="bachelor">Bachelor</option><option value="master">Master</option><option value="doctoral">Promotion</option></select></label>
      {options.subject.length > 0 && <label>Fach<select name="subject" defaultValue={answers.facts.subject || ""}><option value="">Weiß ich nicht</option><option value={NOT_LISTED}>Mein Fach ist nicht dabei</option><option value="prefer_not_to_say">Möchte ich nicht sagen</option>{subjectOptions(options)}</select></label>}
      {options.institution.length > 0 && <label>Hochschule<select name="institution" defaultValue={answers.facts.institution || ""}><option value="">Weiß ich nicht</option><option value={NOT_LISTED}>Meine Hochschule ist nicht dabei</option><option value="prefer_not_to_say">Möchte ich nicht sagen</option>{options.institution.map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
      <label>Fachsemester<select name="semester_number" defaultValue={answers.facts.semester_number || ""}><option value="">Weiß ich nicht</option><option value="prefer_not_to_say">Möchte ich nicht sagen</option>{Array.from({ length: 20 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>
      {options.usesStudyPlan && <label>Vorhaben<select name="future_plan" defaultValue={answers.facts.future_plan || ""}><option value="">Nichts davon</option><option value="prefer_not_to_say">Möchte ich nicht sagen</option>{plans.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="btn dark" disabled={!ready || answers.loading}>{answers.loading ? "Wird abgeglichen …" : "Liste sortieren"}</button><a className="btn link" href="/">Lieber chatten</a></div>
    </form>
    <p className="fine">{demoMode ? "Die Auswahl kommt aus den erfundenen Beispielen." : "Die Auswahl kommt aus den geprüften Regeln, nicht aus einer vollständigen Liste."} Regelbasierter Abgleich, keine Entscheidung über deine Berechtigung.</p>
  </div></section>;
}
