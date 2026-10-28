import type { SubjectInfo } from "./study-fit";

export type DiscoveryFacts = Partial<Record<"institution" | "degree_level" | "subject" | "semester_number" | "future_plan", string>>;

export type DiscoveryInterpretation = {
  facts: DiscoveryFacts;
  searchIntent: { location: string; exclusions: string };
  understood: string[];
  clarification: string | null;
  // The one question to ask again when two values were named for it.
  conflictField?: keyof DiscoveryFacts;
};

const normalise = (value: string) => value.toLocaleLowerCase().replaceAll("_", " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function optionMatches(text: string, values: string[]) {
  return values.filter((value) => text.includes(` ${normalise(value)} `));
}

// A taxonomy subject is found by its code or its German name ("Informatik").
export function interpretGoal(goal: string, options: { institution: string[]; subject: string[]; subjectInfo?: SubjectInfo; usesStudyPlan: boolean }): DiscoveryInterpretation {
  const text = ` ${normalise(goal)} `;
  const facts: DiscoveryFacts = {};
  const understood: string[] = [];
  const institutions = optionMatches(text, options.institution);
  const subjects = options.subject.filter(value => optionMatches(text, [value, options.subjectInfo?.[value]?.label || value]).length);
  const degrees = [
    [/\b(phd|ph d|doctorate|doctoral|promotion|promoviere\w*|doktor\w*)\b/, "doctoral"],
    [/\b(master|masters|msc|ma|masterstudium)\b/, "master"],
    [/\b(bachelor|bachelors|undergraduate|bsc|ba|bachelorstudium)\b/, "bachelor"],
  ].filter(([pattern]) => (pattern as RegExp).test(text)).map(([, value]) => value as string);
  const semesters = [...new Set([
    ...[...text.matchAll(/\b(?:fach)?semester\s*(\d{1,2})\b/g)].map(match => Number(match[1])),
    ...[...text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:fach)?semester\b/g)].map(match => Number(match[1])),
  ])];
  const plans = [
    [/\b(exchange|study abroad)\b/, "exchange"], [/\binternship\b/, "internship"],
    [/\bthesis\b/, "thesis"], [/\bgraduat(?:e|ing|ion)\b/, "graduation"],
  ].filter(([pattern]) => (pattern as RegExp).test(text)).map(([, value]) => value as string);
  const rawLocation = goal.match(/\b(?:study|funding|scholarships?)\s+in\s+([\p{L}][\p{L} .'-]{1,40}?)(?=\s+(?:but|without|excluding)|[,.]|$)/iu)?.[1]?.trim() || "";
  const rawExclusions = goal.match(/\b(?:exclude|excluding|without|but not)\s+([^,.]{1,80})/iu)?.[1]?.trim() || "";
  const conflicts: string[] = [];
  let conflictField: keyof DiscoveryFacts | undefined;
  const conflict = (field: keyof DiscoveryFacts, message: string) => { conflicts.push(message); conflictField ??= field; };

  if (institutions.length === 1) { facts.institution = institutions[0]; understood.push(`Institution: ${institutions[0]}`); }
  else if (institutions.length > 1) conflict("institution", "Choose one institution so Scholarable does not guess between them.");
  if (degrees.length === 1) { facts.degree_level = degrees[0]; understood.push(`Study level: ${degrees[0]}`); }
  else if (degrees.length > 1) conflict("degree_level", "Choose one study level so Scholarable does not guess between them.");
  if (subjects.length === 1) { facts.subject = subjects[0]; understood.push(`Subject: ${subjects[0].replaceAll("_", " ")}`); }
  else if (subjects.length > 1) conflict("subject", "Choose one subject so Scholarable does not guess between them.");
  if (semesters.length === 1 && semesters[0] >= 1 && semesters[0] <= 20) { facts.semester_number = String(semesters[0]); understood.push(`Current semester: ${semesters[0]}`); }
  else if (semesters.length > 1) conflict("semester_number", "Choose one current semester so Scholarable does not guess between them.");
  else if (semesters.length === 1) conflict("semester_number", "Enter a current semester from 1 to 20.");
  if (plans.length === 1 && options.usesStudyPlan) { facts.future_plan = plans[0]; understood.push(`Near-term study plan: ${plans[0]}`); }
  else if (plans.length > 1 && options.usesStudyPlan) conflict("future_plan", "Choose one near-term study plan so Scholarable does not guess between them.");
  if (rawLocation) understood.push(`Preferred location: ${rawLocation}`);
  if (rawExclusions) understood.push(`Exclusions: ${rawExclusions}`);

  return {
    facts,
    searchIntent: { location: rawLocation, exclusions: rawExclusions },
    understood,
    clarification: conflicts[0] || (understood.length ? null : "We could not map that request to a supported study fact yet. Add your study level, subject, institution, or semester, or continue and answer directly."),
    ...(conflictField ? { conflictField } : {}),
  };
}

// "Ich bin 19" or "17 Jahre" answers the age question with yes or no; the age
// itself is never kept. A semester ("ich bin 3. Semester") is not an age.
export function interpretAge(goal: string, minimum = 18): "yes" | "no" | null {
  const match = goal.match(/\b(?:ich bin|i am|i'm)\s+(\d{1,2})\b(?!\s*\.|\s*(?:st|nd|rd|th)\b|\s*(?:fach)?semester)/i)
    || goal.match(/\b(\d{1,2})\s*(?:jahre|jahr|j\.|years?)\b(?!\s*(?:studium|studier))/i);
  if (!match) return null;
  return Number(match[1]) >= minimum ? "yes" : "no";
}

// Enrichment fills gaps; conflicting sources never silently replace reviewed answers.
export function mergeDiscoveryFacts(current: DiscoveryFacts, incoming: DiscoveryFacts) {
  return {
    facts: { ...current, ...Object.fromEntries(Object.entries(incoming).filter(([field]) => !current[field as keyof DiscoveryFacts])) } as DiscoveryFacts,
    conflicts: Object.keys(incoming).filter(field => current[field as keyof DiscoveryFacts] && current[field as keyof DiscoveryFacts] !== incoming[field as keyof DiscoveryFacts]),
  };
}
