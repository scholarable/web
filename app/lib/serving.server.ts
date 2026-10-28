import { demoMode } from "./demo-mode";
import { neon } from "@neondatabase/serverless";
import type { ScholarshipSummary } from "./contracts";
import { publicDetails, studyScope, type PublicDetails } from "./public-details";
import { applicationGuide, callGuide, GUIDE_PARTS, type ApplicationGuideData, type CallGuideData } from "./application-guide";
import { browseFilters, browseQuery, browseSubjectsQuery, CATALOGUE_CAPACITY, DEADLINE_AS_TEXT, mentionedRuleIds, mentionedValues, type BrowseFilters, type SubjectChoice } from "./browse";
import { audienceText, moneyText, timingText } from "./catalogue-copy";
import { cardFacts, type CardFacts } from "./cards";
import { callDisplayTitle, providerDisplayName } from "./provider-names";
import { todayInBerlin } from "./deadline-watch";
import type { SubjectTag } from "./study-fit";

export type ServingEnv = { SCHOLARABLE_SERVING_DATABASE_URL?: string };
export async function servingQuery(env: ServingEnv | undefined) {
  if (!env?.SCHOLARABLE_SERVING_DATABASE_URL) throw new Error("Serving connection unavailable");
  const sql = neon(env.SCHOLARABLE_SERVING_DATABASE_URL);
  const roles = await sql.query("select current_user as role", []);
  if (roles[0]?.role !== "scholarable_serving") throw new Error("Dedicated serving role required");
  return sql.query.bind(sql);
}
// applyNow: listed in apply_now_calls, the list's "Jetzt offen". family: the
// declared scholarship family the call belongs to (public_call_families), shown
// once in the list. institutions and subjects: the verified universities
// (public_call_institutions, or the family's) and taxonomy subjects
// (public_call_subjects) of a call that is only for some.
export type ScholarshipListItem = ScholarshipSummary & { card: CardFacts; applyNow: boolean; family: string | null; institutions: string[]; subjects: SubjectTag[] };
// scholarships holds every match (at most CATALOGUE_CAPACITY); total is their count.
type BrowseResult = BrowseFilters & { subjects: SubjectChoice[]; today: string } & ({ state: "ready"; scholarships: ScholarshipListItem[]; total: number } | { state: "unavailable"; reason: string });

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0 && item.length <= 160) : [];
const code = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9_-]{0,79}$/.test(value);
// The taxonomy subjects of a row ({code, name, group, group_name}); malformed entries are dropped.
export function subjectTags(value: unknown): SubjectTag[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(tag => !tag || typeof tag !== "object" || !code(tag.code) || typeof tag.name !== "string" || !tag.name.trim() || tag.name.length > 160
    || (tag.group != null && !code(tag.group)) ? [] : [{ code: tag.code, name: tag.name.trim(), group: tag.group ?? null,
      group_name: typeof tag.group_name === "string" && tag.group_name.trim() && tag.group_name.length <= 160 ? tag.group_name.trim() : null }]);
}
// Browse rows carry the positive mentions as lists; the detail row carries the
// whole matching payload instead.
export function mentions(call: Record<string, unknown>, key: "degree_level" | "subject" | "institution"): string[] {
  const payload = call.matching_payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return mentionedValues(payload as { requirements?: unknown }, key);
  return strings(call[{ degree_level: "mentioned_degree_levels", subject: "mentioned_subjects", institution: "mentioned_institutions" }[key]]);
}

export function summary(call: Record<string, unknown>): ScholarshipSummary {
  const provider = typeof call.provider_name === "string" && call.provider_name.trim() ? call.provider_name.trim()
    : (call.details && typeof call.details === "object" && typeof (call.details as { provider_name?: unknown }).provider_name === "string")
      ? String((call.details as { provider_name: string }).provider_name) : null;
  return {
    id: String(call.id), slug: String(call.slug), title: callDisplayTitle(String(call.title || "Verified scholarship call"), provider),
    provider: provider && providerDisplayName(provider),
    funding: moneyText({ min: call.funding_amount_min_minor, max: call.funding_amount_max_minor, currency: call.funding_currency,
      frequency: call.funding_frequency, durationMonths: call.funding_duration_months }),
    deadline: timingText({ applicationStatus: call.application_status, effectiveState: call.effective_application_state, deadlineOn: call.deadline_on }),
    audience: audienceText({ degreeLevels: mentions(call, "degree_level"), subjects: mentions(call, "subject").sort(), institutions: mentions(call, "institution").sort(),
      subjectScope: studyScope(call.subject_scope), institutionScope: studyScope(call.institution_scope) }),
    status: call.application_status === "open" ? "open" : call.application_status === "planned" ? "planned" : "not_announced",
    lastChecked: call.last_verified_at ? String(call.last_verified_at) : null,
    reviewOverdue: call.review_overdue === true,
  };
}

// The card facts of one serving row: the browse row carries the positive
// mentions and the detail row the whole matching payload (only rule
// identifiers leave it, never values).
export function card(call: Record<string, unknown>, today: string): CardFacts {
  const payload = call.matching_payload && typeof call.matching_payload === "object" ? call.matching_payload as { requirements?: unknown } : null;
  const details = call.details && typeof call.details === "object" ? call.details as Record<string, unknown> : null;
  return cardFacts({
    funding: details ? details.funding : call.funding_components, tracks: details ? details.tracks : call.tracks, windows: details ? details.windows : call.windows,
    applicationStatus: call.application_status, effectiveState: call.effective_application_state, deadlineOn: call.deadline_on,
    summaryMoney: { min: call.funding_amount_min_minor, max: call.funding_amount_max_minor, currency: call.funding_currency,
      frequency: call.funding_frequency, durationMonths: call.funding_duration_months },
    levels: mentions(call, "degree_level"), levelRuleIds: payload ? mentionedRuleIds(payload, "degree_level") : strings(call.level_rule_ids),
    subjectScope: call.subject_scope, institutionScope: call.institution_scope,
  }, today);
}

// One choice per value, at most 100: a taxonomy subject keeps its German name.
export function subjectChoices(rows: Record<string, unknown>[]): SubjectChoice[] {
  const choices = new Map<string, SubjectChoice>();
  for (const row of rows) {
    const value = String(row.subject), label = typeof row.label === "string" && row.label.trim() ? row.label : null;
    if (!choices.has(value) || (label && !choices.get(value)!.label)) choices.set(value, { value, label });
  }
  return [...choices.values()].slice(0, 100);
}

export async function browseServingCalls(url: URL, env: ServingEnv | undefined, connect = servingQuery, today = todayInBerlin()): Promise<BrowseResult> {
  const filters = browseFilters(url);
  if (demoMode) return (await import("./demo-catalogue.server")).demoBrowse(filters, undefined, today);
  const connectionString = env?.SCHOLARABLE_SERVING_DATABASE_URL;
  if (!connectionString) return { ...filters, subjects: [], today, state: "unavailable", reason: "Die geprüften Stipendien sind noch nicht verbunden." };
  try {
    const query = await connect(env);
    const statement = browseQuery(filters);
    const [rows, subjectRows] = await Promise.all([query(statement.text, statement.values), query(browseSubjectsQuery, [])]);
    // More calls than the page was built and measured for: say so, never show a cut list.
    if (rows.length > CATALOGUE_CAPACITY) return { ...filters, subjects: [], today, state: "unavailable", reason: "Die Liste ist gerade größer, als diese Seite anzeigen kann. Bitte versuch es später noch einmal." };
    return { ...filters, subjects: subjectChoices(subjectRows), today, state: "ready", total: rows.length,
      scholarships: rows.map((row) => ({ ...summary(row as Record<string, unknown>), card: card(row as Record<string, unknown>, today), applyNow: row.apply_now === true,
        family: typeof row.family === "string" && /^[a-z][a-z_]{1,39}$/.test(row.family) ? row.family : null, institutions: strings(row.institutions), subjects: subjectTags(row.taxonomy_tags) })) };
  } catch {
    return { ...filters, subjects: [], today, state: "unavailable", reason: "Die Stipendien sind gerade nicht erreichbar. Bitte versuch es später noch einmal." };
  }
}

export type ServingScholarship = ScholarshipSummary & { details: PublicDetails; fundingNotes: string | null; subjects: string[]; institutions: string[]; card: CardFacts; today: string };
export async function servingCall(slug: string, env: ServingEnv | undefined, connect = servingQuery, today = todayInBerlin()): Promise<{ state: "ready"; scholarship: ServingScholarship } | { state: "missing" | "unavailable" }> {
  if (demoMode) return (await import("./demo-catalogue.server")).demoDetail(slug, today);
  const connectionString = env?.SCHOLARABLE_SERVING_DATABASE_URL;
  if (!connectionString) return { state: "unavailable" };
  try {
    const query = await connect(env);
    const rows = await query(
      `select r.id, r.slug, r.title, r.application_status, r.effective_application_state, r.funding_amount_min_minor, r.funding_amount_max_minor,
         r.funding_currency, r.funding_frequency, r.funding_duration_months, r.funding_notes, ${DEADLINE_AS_TEXT}, r.last_verified_at, r.review_overdue,
         r.institution_scope, r.subject_scope, d.details, m.matching_payload,
         (select coalesce(jsonb_agg(s.name order by s.name), '[]'::jsonb) from public_call_subjects s where s.call_id = r.id) as taxonomy_subjects,
         (select coalesce(jsonb_agg(i.name order by i.name), '[]'::jsonb) from public_call_institutions i where i.call_id = r.id) as listed_institutions
       from recommendation_ready_calls r join public_call_details d on d.call_id = r.id
       join matching_ready_calls m on m.call_id = r.id
       where r.slug = $1 limit 1`, [slug],
    );
    if (!rows[0]) return { state: "missing" };
    const row = rows[0] as Record<string, unknown>;
    return { state: "ready", scholarship: { ...summary(row), details: publicDetails(row.details, row.matching_payload, row),
      fundingNotes: typeof row.funding_notes === "string" && row.funding_notes.trim() && row.funding_notes.length <= 2000 ? row.funding_notes.trim() : null,
      subjects: [...new Set([...strings(row.taxonomy_subjects), ...mentions(row, "subject").sort()])], institutions: [...new Set([...strings(row.listed_institutions).map(providerDisplayName), ...mentions(row, "institution").sort()])], card: card(row, today), today } };
  } catch {
    return { state: "unavailable" };
  }
}

export async function servingGuide(callId: string, env: ServingEnv | undefined, connect = servingQuery): Promise<{ state: "ready"; guide: ApplicationGuideData } | { state: "not_ready" | "unavailable" }> {
  if (demoMode) {
    const guide = (await import("./demo-catalogue.server")).demoGuide(callId);
    return guide ? { state: "ready", guide } : { state: "not_ready" };
  }
  if (!/^\d{1,20}$/.test(callId)) return { state: "not_ready" };
  if (!env?.SCHOLARABLE_SERVING_DATABASE_URL) return { state: "unavailable" };
  try {
    const query = await connect(env);
    const rows = await query("select guide from public_application_guides where call_id = $1 limit 1", [callId]);
    if (!rows[0]) return { state: "not_ready" };
    const guide = applicationGuide(rows[0].guide);
    return guide ? { state: "ready", guide } : { state: "unavailable" };
  } catch { return { state: "unavailable" }; }
}

// The scholarship page's guide: the verified application details of every listed
// call with each part's coverage (public_call_guides), so one incomplete part no
// longer hides the others. Preparing an application keeps servingGuide's packet,
// which only an application-ready call has.
export async function servingCallGuide(callId: string, env: ServingEnv | undefined, connect = servingQuery): Promise<{ state: "ready"; guide: CallGuideData } | { state: "not_ready" | "unavailable" }> {
  if (demoMode) {
    const packet = (await import("./demo-catalogue.server")).demoGuide(callId);
    if (!packet) return { state: "not_ready" };
    const { packet_version: _version, questions_status, questions_status_explanation: _explanation, ...items } = packet;
    return { state: "ready", guide: { ...items, application_ready: true,
      parts: Object.fromEntries(GUIDE_PARTS.map(part => [part, part === "application_questions" ? questions_status : "complete"])) } };
  }
  if (!/^\d{1,20}$/.test(callId)) return { state: "not_ready" };
  if (!env?.SCHOLARABLE_SERVING_DATABASE_URL) return { state: "unavailable" };
  try {
    const query = await connect(env);
    const rows = await query("select guide from public_call_guides where call_id = $1 limit 1", [callId]);
    if (!rows[0]) return { state: "not_ready" };
    const guide = callGuide(rows[0].guide);
    return guide ? { state: "ready", guide } : { state: "unavailable" };
  } catch { return { state: "unavailable" }; }
}
