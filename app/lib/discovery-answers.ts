import { useSyncExternalStore } from "react";
import type { MatchRequest, MatchResult, Recommendation } from "./contracts";
import type { DiscoveryFacts } from "./discovery";
import { NOT_LISTED } from "./study-fit";

// The chat's answers and the match result live in this tab's memory only:
// shared by the list and the scholarship pages while the student moves
// between them, never written to cookies, browser storage or URLs, cleared on
// reset, reload, leaving the site and after 24 hours. The server render
// always sees the empty state, so no answer can cross between requests.
export type ChatMessage = { who: "bot" | "me"; text: string };
export type AnswerField = keyof DiscoveryFacts | "adult";
export type AnswersState = {
  facts: DiscoveryFacts;
  adult: "yes" | "no" | null;
  // Questions already answered, including "weiß ich nicht", so none is asked twice.
  asked: AnswerField[];
  chat: ChatMessage[];
  // What the chat read from typed text, shown for confirmation before it counts.
  proposal: { facts: DiscoveryFacts; adult: "yes" | "no" | null } | null;
  result: MatchResult | null;
  loading: boolean;
  error: string | null;
};
const empty: AnswersState = { facts: {}, adult: null, asked: [], chat: [], proposal: null, result: null, loading: false, error: null };
let state = empty;
const listeners = new Set<() => void>();
let pending: AbortController | null = null;
let expiry: number | null = null;
let watching = false;

function publish(next: AnswersState) {
  state = next;
  for (const listener of listeners) listener();
}
function watch() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("pagehide", resetAnswers);
}
function touch() {
  if (typeof window === "undefined") return;
  watch();
  if (expiry === null) expiry = window.setTimeout(resetAnswers, 24 * 60 * 60 * 1000);
}

export function resetAnswers() {
  pending?.abort(); pending = null;
  if (expiry !== null && typeof window !== "undefined") window.clearTimeout(expiry);
  expiry = null;
  publish(empty);
}
export function setAnswers(change: { facts?: DiscoveryFacts; adult?: "yes" | "no" | null; asked?: AnswerField[]; forget?: AnswerField[] }) {
  touch();
  pending?.abort(); pending = null;
  const facts = { ...state.facts, ...(change.facts || {}) };
  for (const field of change.forget || []) if (field !== "adult") delete facts[field];
  const asked = [...new Set([...state.asked.filter(field => !(change.forget || []).includes(field)), ...(change.asked || [])])];
  const adult = change.adult !== undefined ? change.adult : (change.forget || []).includes("adult") ? null : state.adult;
  publish({ ...state, facts, adult, asked, proposal: null, result: null, loading: false, error: null });
}
export function say(...messages: ChatMessage[]) {
  touch();
  publish({ ...state, chat: [...state.chat, ...messages].slice(-60) });
}
export function propose(proposal: AnswersState["proposal"]) {
  touch();
  publish({ ...state, proposal });
}
// The current answers, for event handlers that continue after an answer.
export const getAnswers = (): AnswersState => state;
export function useAnswers(): AnswersState {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state, () => empty);
}
export const readyToMatch = (answers: Pick<AnswersState, "facts" | "adult">) => answers.adult === "yes" && !!answers.facts.degree_level;

// "Nicht dabei" stays in this tab: matching and a saved profile get an unknown answer.
function valueState(value: string) { return value === "prefer_not_to_say" ? "prefer_not_to_say" as const : value && value !== NOT_LISTED ? "known" as const : "unknown" as const; }
function answer(value: string | undefined, numeric = false) {
  const kind = valueState(value || "");
  return { value: kind === "known" ? (numeric ? Number(value) : String(value)) : null, value_state: kind, confirmation_state: "confirmed" as const };
}
// The /api/matches request for confirmed answers; the age answer is its own explicit choice.
export function matchRequest(facts: DiscoveryFacts): MatchRequest {
  return { profile: { facts: {
    adult_confirmation: { value: true, value_state: "known", confirmation_state: "confirmed" },
    institution: answer(facts.institution),
    degree_level: answer(facts.degree_level),
    subject: answer(facts.subject),
    semester_number: answer(facts.semester_number, true),
    milestone: answer(facts.future_plan),
  } } };
}
// Sends the confirmed answers to the matching service; nothing is sent before
// the student has given a study level and confirmed the age question.
export async function runMatch(): Promise<MatchResult | null> {
  if (!readyToMatch(state)) return null;
  pending?.abort();
  const controller = new AbortController();
  pending = controller;
  publish({ ...state, loading: true, error: null });
  try {
    const response = await fetch("/api/matches", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(matchRequest(state.facts)), signal: controller.signal, cache: "no-store" });
    const data = await response.json();
    if (controller.signal.aborted) return null;
    if (!response.ok) { publish({ ...state, loading: false, error: "Der Abgleich ist gerade nicht erreichbar. Bitte versuch es gleich noch einmal." }); return null; }
    publish({ ...state, loading: false, result: data as MatchResult });
    return data as MatchResult;
  } catch {
    if (!controller.signal.aborted) publish({ ...state, loading: false, error: "Keine Verbindung zum Abgleich. Bitte versuch es noch einmal." });
    return null;
  } finally { if (pending === controller) pending = null; }
}

export type CallFit = {
  // "ok": a rule names your study level; "no": the rules conflict with an
  // answer; "un": the levels depend on a track; "none": no level stated.
  level: "ok" | "no" | "un" | "none";
  conflict: boolean;
  unknown: number;
  best: Recommendation | null;
  conflictLabel: string | null;
};
// One call's place in a match result: its best track or route first, never
// an eligibility decision.
export function callFit(result: MatchResult, callId: string, levelRuleIds: string[], trackId?: string | null): CallFit | null {
  const variants = result.recommendations.filter(item => item.call_id === callId && (trackId === undefined || item.track_id === trackId));
  if (!variants.length) return null;
  const rank = { match: 0, needs_confirmation: 1, mismatch: 2 } as const;
  const best = [...variants].sort((a, b) => rank[a.status] - rank[b.status])[0];
  const conflict = variants.every(item => item.status === "mismatch");
  const named = (ids: { id: string }[]) => ids.some(criterion => levelRuleIds.includes(String(criterion.id)));
  const level = named(best.criteria.matched) ? "ok" : conflict && variants.some(item => named(item.criteria.mismatched)) ? "no" : levelRuleIds.length ? "un" : "none";
  return { level, conflict, unknown: best.criteria.unknown.length, best, conflictLabel: conflict ? best.criteria.mismatched[0]?.label || null : null };
}
