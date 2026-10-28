import type { ProfileItem } from "./profile-vault";

export const answerThemes = ["motivation", "leadership", "challenge", "impact", "community", "financial_context", "study_goals", "career_plans"] as const;
export type AnswerTheme = typeof answerThemes[number];
export type AnswerLibraryVersion = {
  version: number;
  answer: string;
  themes: AnswerTheme[];
  profile_links: { item_id: number; version: number; content: Record<string, unknown> }[];
  approved_at: string;
};
export type AnswerLibraryItem = {
  id: string;
  call_id: string;
  programme_title: string;
  packet_version: string;
  question_id: string;
  question: { prompt: string; word_limit?: number | null; character_limit?: number | null };
  draft_version: number;
  archived_at: string | null;
  created_at: string;
  reflection: { interview_invitation?: boolean; feedback?: string; outcome?: "accepted" | "rejected" | "waitlisted" | "withdrawn"; lessons?: string };
  reflection_version: number;
  submitted: boolean;
  history: AnswerLibraryVersion[];
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown) => typeof value === "string" && /^[1-9][0-9]{0,17}$/.test(value);

export function answerLibrary(value: unknown): AnswerLibraryItem[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const result: AnswerLibraryItem[] = [];
  for (const item of value) {
    if (!record(item) || !id(item.id) || !id(item.call_id) || typeof item.programme_title !== "string"
      || !item.programme_title || item.programme_title.length > 500 || typeof item.packet_version !== "string"
      || item.packet_version.length > 500 || !record(item.question) || typeof item.question.prompt !== "string"
      || item.question.prompt.length > 4000 || typeof item.question_id !== "string" || item.question_id.length > 100
      || !Number.isSafeInteger(item.draft_version) || Number(item.draft_version) < 1
      || !(item.archived_at === null || typeof item.archived_at === "string")
      || typeof item.created_at !== "string" || typeof item.submitted !== "boolean"
      || !record(item.reflection) || !Number.isSafeInteger(item.reflection_version) || Number(item.reflection_version) < 0
      || Object.keys(item.reflection).some(key => !["interview_invitation", "feedback", "outcome", "lessons"].includes(key))
      || (item.reflection.interview_invitation !== undefined && typeof item.reflection.interview_invitation !== "boolean")
      || (item.reflection.feedback !== undefined && (typeof item.reflection.feedback !== "string" || item.reflection.feedback.length > 2000))
      || (item.reflection.lessons !== undefined && (typeof item.reflection.lessons !== "string" || item.reflection.lessons.length > 2000))
      || (item.reflection.outcome !== undefined && !["accepted", "rejected", "waitlisted", "withdrawn"].includes(String(item.reflection.outcome)))
      || !Array.isArray(item.history) || item.history.length < 1 || item.history.length > 100) return null;
    for (const version of item.history) {
      if (!record(version) || !Number.isSafeInteger(version.version) || Number(version.version) < 1
        || typeof version.answer !== "string" || !version.answer.trim() || version.answer.length > 20000
        || !Array.isArray(version.themes) || version.themes.length > 8
        || version.themes.some(theme => !answerThemes.includes(theme as AnswerTheme))
        || !Array.isArray(version.profile_links) || version.profile_links.length > 20
        || version.profile_links.some(link => !record(link) || !Number.isSafeInteger(link.item_id)
          || !Number.isSafeInteger(link.version) || !record(link.content))
        || typeof version.approved_at !== "string") return null;
    }
    result.push(item as AnswerLibraryItem);
  }
  return result;
}

const words = (value: string) => new Set((value.toLocaleLowerCase("en").match(/[\p{L}\p{N}]{4,}/gu) || [])
  .filter(word => !["this", "that", "your", "with", "from", "what", "have", "were", "will", "about"].includes(word)));

export function suggestedAnswers(items: AnswerLibraryItem[], prompt: string, currentCallId: string, currentQuestionId: string) {
  const target = words(prompt);
  // ponytail: scan at most 100 private answers; add an index only if the library limit grows.
  return items.filter(item => !item.archived_at && (item.call_id !== currentCallId || item.question_id !== currentQuestionId))
    .map(item => {
      const shared = [...words(item.question.prompt)].filter(word => target.has(word));
      return { item, reason: shared.length ? `Beide Fragen erwähnen ${shared.slice(0, 3).join(", ")}.` : "", score: shared.length };
    }).filter(match => match.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
}

export function suggestedStories(items: ProfileItem[], prompt: string) {
  const target = words(prompt);
  return items.filter(item => item.kind === "story" && item.confirmation_state === "confirmed")
    .map(item => {
      const shared = [...words([item.title, item.summary, ...(item.tags || [])].filter(Boolean).join(" "))]
        .filter(word => target.has(word));
      return { item, reason: shared.length ? `Geschichte und Frage erwähnen beide ${shared.slice(0, 3).join(", ")}.` : "", score: shared.length };
    }).filter(match => match.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
}

export function reuseWarnings(item: AnswerLibraryItem, profileItems: ProfileItem[]): string[] {
  const links = item.history[0].profile_links;
  if (!links.length) return ["Mit dieser Antwort sind keine Profilangaben verknüpft. Prüf jede persönliche Aussage, bevor du sie wiederverwendest."];
  const warnings: string[] = [];
  for (const link of links) {
    const current = profileItems.find(profile => profile.id === link.item_id);
    if (!current || current.confirmation_state !== "confirmed") warnings.push(`Verknüpfter Profileintrag ${link.item_id} ist nicht mehr bestätigt.`);
    else if (current.version !== link.version || current.has_conflict) warnings.push(`Verknüpfter Profileintrag ${link.item_id} hat sich geändert oder widerspricht einem anderen Eintrag.`);
  }
  return warnings;
}
