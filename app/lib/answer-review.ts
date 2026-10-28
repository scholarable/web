import type { GuideQuestion } from "./application-guide";

export const writingActions = ["draft", "critique", "rewrite", "shorten", "tone"] as const;
export type WritingAction = typeof writingActions[number];

export function reviewAnswer(answer: string, question: Pick<GuideQuestion, "word_limit" | "character_limit">, otherAnswers: string[]) {
  const trimmed = answer.trim();
  const words = trimmed ? trimmed.split(/\s+/u).length : 0;
  const characters = [...answer].length;
  const warnings: string[] = [];
  if (!trimmed) warnings.push("Diese Frage hat noch keine Antwort.");
  if (question.word_limit && words > question.word_limit) warnings.push(`${words - question.word_limit} Wörter über der geprüften Grenze von ${question.word_limit} Wörtern.`);
  if (question.character_limit && characters > question.character_limit) warnings.push(`${characters - question.character_limit} Zeichen über der geprüften Grenze von ${question.character_limit} Zeichen.`);
  const normalized = trimmed.replace(/\s+/gu, " ").toLocaleLowerCase();
  if (normalized.length >= 80 && otherAnswers.some(other => other.trim().replace(/\s+/gu, " ").toLocaleLowerCase().includes(normalized))) {
    warnings.push("Diese Antwort wiederholt Text aus einer anderen Frage.");
  }
  return { words, characters, warnings };
}
