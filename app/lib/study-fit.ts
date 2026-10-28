import { providerDisplayName } from "./provider-names";
import type { StudyScope } from "./public-details";

// How a call that is only for some universities or subjects relates to the
// student's chat answers. "own": the call names the answer; "other": the site
// is sure it does not (the list folds it away below); "check": it cannot tell,
// so the call stays in the list without "Passt zu dir" and names what it
// names. Hiding a scholarship that is the student's is worse than showing one
// that is not (coordination decision 2026-10-28), so anything unsure is "check".
export type ScopeFit = "own" | "other" | "check";

// The chooser's "Meine Hochschule ist nicht dabei" / "Mein Fach ist nicht
// dabei": kept in this tab only, sent to matching as an unknown answer.
export const NOT_LISTED = "__not_listed__";

// One form for comparing names: the German display name (provider-names.ts)
// applied to both sides, then lower case without punctuation.
const key = (name: string) => providerDisplayName(name).toLocaleLowerCase("de").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const sameUniversity = (a: string, b: string): boolean => !!key(a) && key(a) === key(b);
// One name is the other with words added ("Goethe-Universität" and
// "Goethe-Universität Frankfurt am Main"): perhaps the same university.
const variant = (a: string, b: string): boolean => {
  const x = key(a), y = key(b);
  return !!x && !!y && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `));
};

export type UniversityNames = { provider: string | null; family: string | null; institutions: string[] };
// The names of a call that are specific universities the site can rely on: a
// university's own call (its provider is one of the names, e.g. Elsa-Neumann
// at FU Berlin naming the four Berlin universities) or a declared family's
// call (each Deutschlandstipendium names its universities). Another
// provider's list (a DAAD programme) may hold a category ("German universities
// of applied sciences") or an English duplicate ("University of Passau"), so it
// adds nothing to the chooser and never folds a call away on its own.
export function specificUniversities(call: UniversityNames): string[] {
  if (!call.institutions.length) return [];
  const own = !!call.provider && call.institutions.some(name => sameUniversity(name, call.provider!));
  return call.family || own ? call.institutions : [];
}
// The universities a student can choose: every specific name, once, A to Z.
export function universityChoices(calls: UniversityNames[]): string[] {
  const choices: string[] = [];
  for (const call of calls) for (const name of specificUniversities(call)) {
    const shown = providerDisplayName(name).trim();
    if (shown && shown.length <= 160 && !choices.some(choice => sameUniversity(choice, shown))) choices.push(shown);
  }
  return choices.sort((a, b) => a.localeCompare(b, "de"));
}

// A call for selected universities against the university answer. Another
// university's call folds away only when every name it gives is a specific
// university, the answer is one of the universities the site knows (or "nicht
// dabei"), and no name could be the answer under another form.
export function universityFit(call: UniversityNames & { scope: StudyScope }, answer: string | null | undefined, known: string[]): ScopeFit | null {
  if (!answer?.trim() || call.scope !== "selected") return null;
  const names = [...call.institutions, ...(call.provider ? [call.provider] : [])];
  if (answer !== NOT_LISTED && names.some(name => sameUniversity(name, answer))) return "own";
  const specific = specificUniversities(call);
  if (!specific.length) return "check";
  if (answer === NOT_LISTED) return "other";
  return known.some(name => sameUniversity(name, answer)) && !names.some(name => variant(name, answer)) ? "other" : "check";
}

// A taxonomy subject a call names (public_call_subjects): a Studienbereich
// with its Fächergruppe, or a whole Fächergruppe (group null).
export type SubjectTag = { code: string; name: string; group: string | null; group_name?: string | null };
// A subject choice's German name and its Fächergruppe (null for a Fächergruppe).
export type SubjectInfo = Record<string, { label: string; group: string | null }>;
// Each code the list knows, with its Fächergruppe (null for a Fächergruppe).
export function subjectGroups(tagLists: SubjectTag[][]): Map<string, string | null> {
  const groups = new Map<string, string | null>();
  for (const tag of tagLists.flat()) {
    groups.set(tag.code, tag.group);
    if (tag.group && !groups.has(tag.group)) groups.set(tag.group, null);
  }
  return groups;
}
// A call for selected subjects against the subject answer. A call naming the
// answer, or the answer's whole Fächergruppe, is "own". Answering a whole
// Fächergruppe leaves its single subjects open, as does a subject the taxonomy
// does not hold; "nicht dabei" leaves a call naming a whole Fächergruppe open.
export function subjectFit(scope: StudyScope, tags: SubjectTag[], answer: string | null | undefined, groups: Map<string, string | null>): ScopeFit | null {
  if (!answer?.trim() || scope !== "selected") return null;
  if (!tags.length) return "check";
  if (answer === NOT_LISTED) return tags.some(tag => tag.group === null) ? "check" : "other";
  if (!groups.has(answer)) return "check";
  const group = groups.get(answer);
  if (tags.some(tag => tag.code === answer || (!!group && tag.code === group))) return "own";
  return group === null && tags.some(tag => tag.group === answer) ? "check" : "other";
}
