import { validDate } from "./activity-planning";

type Sourced = { source_version_id: string; evidence_locator: string };
type Scoped = Sourced & { id: string; track_id: string | null; route_id: string | null };
export type GuideDocument = Scoped & {
  name: string; requirement_kind: "required" | "conditional" | "optional";
  document_phase: string; submitted_by: string; condition_text: string | null;
  instructions: string | null; accepted_formats: string[]; due_on: string | null;
  max_file_size_mb: number | null; max_pages: number | null;
  max_words: number | null; max_characters: number | null;
};
export type GuideStep = Scoped & { position: number; title: string; instructions: string | null; due_on: string | null };
export type GuideStage = Sourced & { id: string; track_id: string | null; position: number; stage_type: string; title: string;
  actor: string | null; description: string | null; criteria_text: string | null; criteria: Record<string, unknown>; expected_on: string | null };
export type GuideQuestion = Scoped & { position: number; prompt: string; help_text: string | null;
  response_kind: "short_text" | "long_text" | "single_choice" | "multiple_choice" | "number" | "date" | "file" | "other";
  requirement_kind: "required" | "conditional" | "optional"; condition_text: string | null;
  word_limit: number | null; character_limit: number | null; options: string[] };
export type GuideRoute = Sourced & { id: string; track_id: string | null; route_type: string; submitted_by: string;
  availability_status: "available" | "not_announced" | "provider_defined" | "unavailable"; name: string; instructions: string };
export type GuideWindow = Scoped & { window_type: string; audience_text: string | null; opens_on: string | null;
  opens_on_precision: string; deadline_on: string | null; deadline_time: string | null; deadline_timezone: string | null;
  deadline_precision: string; recurrence_text: string | null; raw_text: string };
export type GuidePolicy = Sourced & { id: string; track_id: string | null; policy_type: string;
  initial_duration_months: number | null; maximum_duration_months: number | null; review_interval_months: number | null;
  maximum_renewals: number | null; reapplication_allowed: boolean | null; requirements_text: string | null; extension_text: string | null };
export type GuideObligation = Sourced & { id: string; track_id: string | null; obligation_type: string; description: string;
  condition_text: string | null; timing_text: string | null; consequence_text: string | null };
export type ApplicationGuideData = { packet_version: string; questions_status: "complete" | "not_published" | "not_applicable";
  questions_status_explanation: string; application_route_available: boolean; questions: GuideQuestion[];
  routes: GuideRoute[]; windows: GuideWindow[]; documents: GuideDocument[]; steps: GuideStep[];
  selection_stages: GuideStage[]; renewal_policies: GuidePolicy[]; obligations: GuideObligation[] };

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
// The database stores these texts without a length check; these bounds only
// guard the page against an oversized payload. The longest stored text on
// 2026-10-27 was a document instruction of 2,357 characters.
const TEXT = 20_000;
const NAME = 2_000;
const required = (v: unknown, limit = NAME) => typeof v === "string" && v.trim().length > 0 && v.length <= limit ? v : null;
const optional = (v: unknown, limit = TEXT) => v == null ? null : typeof v === "string" && v.length <= limit ? v : undefined;
const scope = (v: unknown) => v == null ? null : required(v, 100) ?? undefined;
const date = (v: unknown) => v == null ? null : typeof v === "string" && validDate(v) ? v : undefined;
const position = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 1000 ? v : null;
const positive = (v: unknown) => v == null ? null : typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
const positiveInt = (v: unknown) => v == null ? null : typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : undefined;
const nonnegativeInt = (v: unknown) => v == null ? null : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
const sourced = (item: Record<string, unknown>) => required(item.source_version_id, 100) && required(item.evidence_locator, 2000);
const time = (v: unknown) => v == null ? null : typeof v === "string" && /^\d{2}:\d{2}(?::\d{2})?$/.test(v) ? v : undefined;

// The application packet (public_application_guides) and the scholarship page
// (public_call_guides) carry the same verified items.
type GuideItems = Pick<ApplicationGuideData, "routes" | "windows" | "questions" | "documents" | "steps" | "selection_stages" | "renewal_policies" | "obligations">;

// Invalid projections fail closed as a whole: never silently present a partial checklist.
export function applicationGuide(value: unknown): ApplicationGuideData | null {
  if (!record(value) || !required(value.packet_version, 500)
    || !["complete", "not_published", "not_applicable"].includes(String(value.questions_status))
    || !required(value.questions_status_explanation, 2000) || typeof value.application_route_available !== "boolean") return null;
  const parsed = guideItems(value);
  if (!parsed || (value.questions_status === "complete") !== (parsed.items.questions.length > 0)) return null;
  return { packet_version: value.packet_version as string, questions_status: value.questions_status as ApplicationGuideData["questions_status"],
    questions_status_explanation: value.questions_status_explanation as string, application_route_available: value.application_route_available as boolean,
    ...parsed.items };
}

// The parts a scholarship page shows, with the coverage the checks left them:
// a partial part shows what was verified and says the rest is on the provider's page.
export const GUIDE_PARTS = ["documents", "application_steps", "application_questions", "selection", "renewal", "obligations"] as const;
export type GuidePart = typeof GUIDE_PARTS[number];
const PART_STATUSES = ["complete", "partial", "not_published", "not_applicable", "unavailable", "provider_defined"] as const;
export type CallGuideData = GuideItems & { application_ready: boolean; application_route_available: boolean;
  parts: Partial<Record<GuidePart, typeof PART_STATUSES[number]>> };

// One unreadable item or coverage value never hides the rest: the item is left
// out and its part counts as incomplete, so the page says the rest is on the
// provider's page (call 9's 2,357-character instruction hid its whole guide).
export function callGuide(value: unknown): CallGuideData | null {
  if (!record(value) || typeof value.application_ready !== "boolean" || typeof value.application_route_available !== "boolean"
    || !record(value.parts)) return null;
  const parts: CallGuideData["parts"] = {};
  for (const [part, status] of Object.entries(value.parts)) {
    if ((GUIDE_PARTS as readonly string[]).includes(part) && (PART_STATUSES as readonly unknown[]).includes(status))
      parts[part as GuidePart] = status as typeof PART_STATUSES[number];
  }
  const parsed = guideItems(value, true);
  if (!parsed) return null;
  for (const part of parsed.dropped) parts[part] = "partial";
  return { application_ready: value.application_ready, application_route_available: value.application_route_available, parts, ...parsed.items };
}

// Whether a page guide's part may miss facts: anything but a complete or an
// explicitly empty part, a missing coverage row included. Packets have no parts.
export const incomplete = (guide: { parts?: CallGuideData["parts"] }, part: GuidePart) =>
  guide.parts !== undefined && !["complete", "not_applicable", "not_published"].includes(guide.parts[part] ?? "unknown");

// Each item on its own: an invalid one fails a packet (see applicationGuide),
// while the page guide drops just that item and marks its part incomplete.
const routeItem = (item: unknown): GuideRoute | null => {
  if (!record(item) || !sourced(item) || !required(item.id, 100) || scope(item.track_id) === undefined
    || !required(item.route_type, 100) || !required(item.submitted_by, 100) || !required(item.name)
    || !required(item.instructions, TEXT) || !["available", "not_announced", "provider_defined", "unavailable"].includes(String(item.availability_status))) return null;
  return { id: item.id as string, track_id: scope(item.track_id)!, route_type: item.route_type as string,
    submitted_by: item.submitted_by as string, availability_status: item.availability_status as GuideRoute["availability_status"],
    name: item.name as string, instructions: item.instructions as string, source_version_id: item.source_version_id as string,
    evidence_locator: item.evidence_locator as string };
};
const windowItem = (item: unknown): GuideWindow | null => {
  if (!record(item) || !sourced(item) || !required(item.id, 100) || scope(item.track_id) === undefined || scope(item.route_id) === undefined
    || !required(item.window_type, 100) || optional(item.audience_text) === undefined || date(item.opens_on) === undefined
    || !required(item.opens_on_precision, 100) || date(item.deadline_on) === undefined || time(item.deadline_time) === undefined
    || optional(item.deadline_timezone, 100) === undefined || !required(item.deadline_precision, 100)
    || optional(item.recurrence_text) === undefined || !required(item.raw_text, TEXT)) return null;
  return { id: item.id as string, track_id: scope(item.track_id)!, route_id: scope(item.route_id)!, window_type: item.window_type as string,
    audience_text: optional(item.audience_text)!, opens_on: date(item.opens_on)!, opens_on_precision: item.opens_on_precision as string,
    deadline_on: date(item.deadline_on)!, deadline_time: time(item.deadline_time)!, deadline_timezone: optional(item.deadline_timezone, 100)!,
    deadline_precision: item.deadline_precision as string, recurrence_text: optional(item.recurrence_text)!, raw_text: item.raw_text as string,
    source_version_id: item.source_version_id as string, evidence_locator: item.evidence_locator as string };
};
const questionItem = (item: unknown): GuideQuestion | null => {
  if (!record(item) || !sourced(item) || !required(item.id, 100) || !required(item.prompt, TEXT) || !position(item.position)
    || scope(item.track_id) === undefined || scope(item.route_id) === undefined || optional(item.help_text) === undefined
    || !["short_text", "long_text", "single_choice", "multiple_choice", "number", "date", "file", "other"].includes(String(item.response_kind))
    || !["required", "conditional", "optional"].includes(String(item.requirement_kind)) || optional(item.condition_text) === undefined
    || (item.requirement_kind === "conditional" && !required(item.condition_text, TEXT))
    || positive(item.word_limit) === undefined || positive(item.character_limit) === undefined
    || !Array.isArray(item.options) || item.options.length > 100 || !item.options.every(option => required(option))) return null;
  return { id: item.id as string, track_id: scope(item.track_id)!, route_id: scope(item.route_id)!, position: item.position as number,
    prompt: item.prompt as string, help_text: optional(item.help_text)!, response_kind: item.response_kind as GuideQuestion["response_kind"],
    requirement_kind: item.requirement_kind as GuideQuestion["requirement_kind"], condition_text: optional(item.condition_text)!,
    word_limit: positive(item.word_limit)!, character_limit: positive(item.character_limit)!, options: item.options as string[],
    source_version_id: item.source_version_id as string, evidence_locator: item.evidence_locator as string };
};
const documentItem = (item: unknown): GuideDocument | null => {
  if (!record(item) || !sourced(item) || !required(item.id, 100) || !required(item.name) || !["required", "conditional", "optional"].includes(String(item.requirement_kind))
    || !required(item.document_phase, 100) || !required(item.submitted_by, 100)
    || scope(item.track_id) === undefined || scope(item.route_id) === undefined
    || optional(item.condition_text) === undefined || optional(item.instructions) === undefined || date(item.due_on) === undefined
    || positive(item.max_file_size_mb) === undefined || positive(item.max_pages) === undefined
    || positive(item.max_words) === undefined || positive(item.max_characters) === undefined
    || !Array.isArray(item.accepted_formats) || item.accepted_formats.length > 20 || !item.accepted_formats.every(format => required(format, 100))) return null;
  return { id: item.id as string, track_id: scope(item.track_id)!, route_id: scope(item.route_id)!, name: item.name as string,
    requirement_kind: item.requirement_kind as GuideDocument["requirement_kind"], document_phase: item.document_phase as string,
    submitted_by: item.submitted_by as string, condition_text: optional(item.condition_text)!, instructions: optional(item.instructions)!,
    accepted_formats: item.accepted_formats as string[], due_on: date(item.due_on)!, max_file_size_mb: positive(item.max_file_size_mb)!,
    max_pages: positive(item.max_pages)!, max_words: positive(item.max_words)!, max_characters: positive(item.max_characters)!,
    source_version_id: item.source_version_id as string, evidence_locator: item.evidence_locator as string };
};
const stepItem = (item: unknown): GuideStep | null => {
  if (!record(item) || !sourced(item) || !required(item.id, 100) || !required(item.title) || !position(item.position)
    || scope(item.track_id) === undefined || scope(item.route_id) === undefined || optional(item.instructions) === undefined || date(item.due_on) === undefined) return null;
  return { id: item.id as string, track_id: scope(item.track_id)!, route_id: scope(item.route_id)!, position: item.position as number,
    title: item.title as string, instructions: optional(item.instructions)!, due_on: date(item.due_on)!,
    source_version_id: item.source_version_id as string, evidence_locator: item.evidence_locator as string };
};
const stageItem = (item: unknown): GuideStage | null => {
  if (!record(item) || !sourced(item) || !required(item.id, 100) || !required(item.stage_type, 100) || !required(item.title) || !position(item.position)
    || scope(item.track_id) === undefined || optional(item.actor) === undefined || optional(item.description) === undefined
    || optional(item.criteria_text) === undefined || !record(item.criteria) || date(item.expected_on) === undefined) return null;
  return { id: item.id as string, track_id: scope(item.track_id)!, position: item.position as number,
    stage_type: item.stage_type as string, title: item.title as string, actor: optional(item.actor)!, description: optional(item.description)!,
    criteria_text: optional(item.criteria_text)!, criteria: item.criteria, expected_on: date(item.expected_on)!,
    source_version_id: item.source_version_id as string, evidence_locator: item.evidence_locator as string };
};
const policyItem = (item: unknown): GuidePolicy | null => {
  if (!record(item) || !sourced(item) || !required(item.id, 100) || scope(item.track_id) === undefined
    || !required(item.policy_type, 100) || positiveInt(item.initial_duration_months) === undefined
    || positiveInt(item.maximum_duration_months) === undefined || positiveInt(item.review_interval_months) === undefined
    || nonnegativeInt(item.maximum_renewals) === undefined || (item.reapplication_allowed != null && typeof item.reapplication_allowed !== "boolean")
    || optional(item.requirements_text) === undefined || optional(item.extension_text) === undefined) return null;
  return { id: item.id as string, track_id: scope(item.track_id)!, policy_type: item.policy_type as string,
    initial_duration_months: positiveInt(item.initial_duration_months)!, maximum_duration_months: positiveInt(item.maximum_duration_months)!,
    review_interval_months: positiveInt(item.review_interval_months)!, maximum_renewals: nonnegativeInt(item.maximum_renewals)!,
    reapplication_allowed: item.reapplication_allowed as boolean | null,
    requirements_text: optional(item.requirements_text)!, extension_text: optional(item.extension_text)!,
    source_version_id: item.source_version_id as string, evidence_locator: item.evidence_locator as string };
};
const obligationItem = (item: unknown): GuideObligation | null => {
  if (!record(item) || !sourced(item) || !required(item.id, 100) || scope(item.track_id) === undefined
    || !required(item.obligation_type, 100) || !required(item.description, TEXT) || optional(item.condition_text) === undefined
    || optional(item.timing_text) === undefined || optional(item.consequence_text) === undefined) return null;
  return { id: item.id as string, track_id: scope(item.track_id)!, obligation_type: item.obligation_type as string,
    description: item.description as string, condition_text: optional(item.condition_text)!, timing_text: optional(item.timing_text)!,
    consequence_text: optional(item.consequence_text)!, source_version_id: item.source_version_id as string,
    evidence_locator: item.evidence_locator as string };
};

function guideItems(value: Record<string, unknown>, keepValid = false): { items: GuideItems; dropped: Set<GuidePart> } | null {
  const dropped = new Set<GuidePart>();
  const list = <T>(raw: unknown, parse: (item: unknown) => T | null, part: GuidePart | null): T[] | null => {
    if (!Array.isArray(raw) || (!keepValid && raw.length > 100)) return null;
    const kept = raw.slice(0, 100).map(parse).filter((item): item is T => item !== null);
    if (kept.length < raw.length) {
      if (!keepValid) return null;
      if (part) dropped.add(part);
    }
    return kept;
  };
  // Routes are shown with the steps; the page takes its dates from the call's details.
  const routes = list(value.routes, routeItem, "application_steps"), windows = list(value.windows, windowItem, null);
  const questions = list(value.questions, questionItem, "application_questions"), documents = list(value.documents, documentItem, "documents");
  const steps = list(value.steps, stepItem, "application_steps"), selection_stages = list(value.selection_stages, stageItem, "selection");
  const renewal_policies = list(value.renewal_policies, policyItem, "renewal"), obligations = list(value.obligations, obligationItem, "obligations");
  if (!routes || !windows || !questions || !documents || !steps || !selection_stages || !renewal_policies || !obligations) return null;
  return { items: { routes, windows, questions, documents, steps, selection_stages, renewal_policies, obligations }, dropped };
}
