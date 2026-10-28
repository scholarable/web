import type { ApplicationGuideData } from "./application-guide";
import type { ProfileItem } from "./profile-vault";
import type { WritingEnv } from "./answer-assistance.server";

export const sampleTitle = "Übungs-Stipendium — erfunden";
export const sampleId = "account-practice-scholarship-v1";
export const sampleCallId = "987654321";
export type PracticeWritingEnv = WritingEnv & { SCHOLARABLE_WRITING_TEST_ENABLED?: string };
export const sampleWritingReady = (env: PracticeWritingEnv | undefined) => env?.SCHOLARABLE_WRITING_TEST_ENABLED === "true"
  && env.SCHOLARABLE_WRITING_BUDGET_CONFIRMED === "true" && env.SCHOLARABLE_WRITING_GATEWAY_ID === "student-writing" && !!env.AI;
export const sampleWritingFact = {
  id: 1, version: 1, kind: "project", title: "Erfundenes Schulbibliotheks-Projekt",
  summary: "Ich möchte mich für dieses erfundene Stipendium bewerben, um weiter eine Büchersammlung für eine ausgedachte Schulbibliothek zu organisieren.",
  outcome: "Die erfundene Sammlung hat 50 Bücher zusammengebracht.",
  confirmation_state: "confirmed", has_conflict: false,
} as ProfileItem;

export function sampleAccountAllowed(email: string, configuredEmail: string | undefined): boolean {
  return !!configuredEmail && email.trim().toLowerCase() === configuredEmail.trim().toLowerCase();
}

// Only a boolean is stored locally. No identity, answers, or account progress is stored here.
const storageKey = "scholarable-account-practice-saved-v1";
export function sampleSaved(storage: Pick<Storage, "getItem">): boolean {
  try { return storage.getItem(storageKey) === "yes"; }
  catch { return false; }
}
export function setSampleSaved(storage: Pick<Storage, "setItem" | "removeItem">, saved: boolean): void {
  if (saved) storage.setItem(storageKey, "yes");
  else storage.removeItem(storageKey);
}

export const sampleGuide: ApplicationGuideData = {
  packet_version: "fictional-practice-v1",
  questions_status: "complete",
  questions_status_explanation: "Erfundene Übungsfrage.",
  application_route_available: false,
  routes: [{ id: "practice-route", track_id: null, route_type: "unavailable", submitted_by: "applicant", availability_status: "unavailable", name: "Übungsweg", instructions: "Für dieses Beispiel gibt es keinen Anbieter und kein Bewerbungsportal.", source_version_id: "fictional", evidence_locator: "fictional practice data" }],
  windows: [{ id: "practice-window", track_id: null, route_id: null, window_type: "application", audience_text: "Erfundene Bewerberinnen und Bewerber", opens_on: null, opens_on_precision: "unknown", deadline_on: null, deadline_time: null, deadline_timezone: null, deadline_precision: "unknown", recurrence_text: null, raw_text: "Keine echte Frist. Das ist ein Übungs-Stipendium.", source_version_id: "fictional", evidence_locator: "fictional practice data" }],
  questions: [{ id: "practice-question", track_id: null, route_id: null, position: 1, prompt: "Warum würdest du dich für dieses erfundene Stipendium bewerben?", help_text: "Nutz nur erfundene Angaben.", response_kind: "long_text", requirement_kind: "required", condition_text: null, word_limit: 150, character_limit: null, options: [], source_version_id: "fictional", evidence_locator: "fictional practice data" }],
  documents: [{ id: "practice-document", track_id: null, route_id: null, name: "Übungs-Notenübersicht", requirement_kind: "required", document_phase: "initial_application", submitted_by: "applicant", condition_text: null, instructions: "Lade kein echtes Dokument hoch.", accepted_formats: [], due_on: null, max_file_size_mb: null, max_pages: null, max_words: null, max_characters: null, source_version_id: "fictional", evidence_locator: "fictional practice data" }],
  steps: [{ id: "practice-step", track_id: null, route_id: null, position: 1, title: "Beispiel-Voraussetzungen ansehen", instructions: "Dieser Schritt ist nur zum Testen der Oberfläche.", due_on: null, source_version_id: "fictional", evidence_locator: "fictional practice data" }],
  selection_stages: [], renewal_policies: [], obligations: [],
};
