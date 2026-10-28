import { demoMode } from "./demo-mode";
import { callFromPayload, evaluateRequirement, recommend, selectedWindow, type MatchVariant, type ServingPayload } from "./matching";
import type { ConfirmedFact, MatchRequest, MatchResult, MatchFollowUp } from "./contracts";
import { CATALOGUE_CAPACITY, SCOPE_COLUMNS, SCOPE_JOINS, SCOPE_LISTS, SERVING_VIEWS_ONCE } from "./browse";
import { servingQuery, type ServingEnv } from "./serving.server";
import { activityDetails, deadlineText } from "./activity-planning";
import { publicDetails } from "./public-details";
import { providerDisplayName } from "./provider-names";
import { universityChoices, type SubjectInfo, type SubjectTag } from "./study-fit";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const fields = ["adult_confirmation", "institution", "degree_level", "subject", "semester_number", "milestone"];

// Validate the boundary without inferring identifiers or promoting withheld facts.
export function parseProfile(input: unknown): MatchRequest["profile"] {
  if (!object(input) || !exactKeys(input, ["profile"]) || !object(input.profile)
    || !exactKeys(input.profile, ["facts"]) || !object(input.profile.facts)) throw new Error("Invalid profile");
  const facts = input.profile.facts;
  if (Object.keys(facts).some((key) => !fields.includes(key))
    || fields.slice(0, 5).some((key) => !Object.hasOwn(facts, key))) throw new Error("Invalid profile");
  const clean: Record<string, ConfirmedFact> = {};
  for (const [key, fact] of Object.entries(facts)) {
    if (!object(fact) || !exactKeys(fact, ["value", "value_state", "confirmation_state"])
      || fact.confirmation_state !== "confirmed") throw new Error("Invalid profile");
    const value = fact.value;
    const missing = ["unknown", "prefer_not_to_say"].includes(String(fact.value_state))
      || (["institution", "subject", "milestone"].includes(key) && fact.value_state === "not_applicable");
    if (key !== "adult_confirmation" && missing) {
      if (value !== null) throw new Error("Invalid profile");
    } else {
      if (fact.value_state !== "known") throw new Error("Invalid profile");
      if (key === "adult_confirmation" && value !== true) throw new Error("Invalid profile");
      if (["institution", "subject"].includes(key) && (typeof value !== "string" || !value.trim() || value.length > 160)) throw new Error("Invalid profile");
      if (key === "degree_level" && !["bachelor", "master", "doctoral"].includes(String(value))) throw new Error("Invalid profile");
      if (key === "semester_number" && (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 20)) throw new Error("Invalid profile");
      if (key === "milestone" && !["exchange", "internship", "thesis", "graduation"].includes(String(value))) throw new Error("Invalid profile");
    }
    clean[key] = { value: typeof value === "string" ? value.trim() : value, value_state: fact.value_state, confirmation_state: "confirmed" } as ConfirmedFact;
  }
  return { facts: clean };
}

// family: the declared scholarship family of the call (public_call_families), if any.
// institutions and subjects: its universities and taxonomy subjects (SCOPE_COLUMNS).
// origins: the reviewed declarations of whom it is for by where the applicant lives.
type CatalogueRow = { id: string; title: string; slug: string; matching_payload: ServingPayload; details?: unknown; family?: unknown; institutions?: unknown; taxonomy_tags?: unknown; origins?: unknown };
const texts = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim() && item.length <= 160) : [];
const tags = (value: unknown): SubjectTag[] => Array.isArray(value) ? value.filter((tag): tag is SubjectTag => !!tag && typeof tag === "object"
  && typeof tag.code === "string" && /^[a-z][a-z0-9_-]{0,79}$/.test(tag.code) && typeof tag.name === "string" && !!tag.name.trim() && tag.name.length <= 160
  && (tag.group == null || (typeof tag.group === "string" && /^[a-z][a-z0-9_-]{0,79}$/.test(tag.group)))) : [];
// The answers the chat offers: every specific university of a listed call
// (study-fit.ts: a university's own calls and the Deutschlandstipendium's
// universities, under their German names), each taxonomy subject a listed call
// names with its Fächergruppe, and any value a stored rule names. askAbroad:
// whether "Lebst du gerade im Ausland …?" can change the list, which needs a
// listed call declared only for applicants from abroad.
export function profileOptions(rows: CatalogueRow[]) {
  const options = { institution: new Set<string>(), subject: new Set<string>() };
  const subjectInfo: SubjectInfo = {};
  for (const row of rows) {
    for (const rule of callFromPayload(row.matching_payload).requirements || []) {
      if (!(rule.fact_key === "institution" || rule.fact_key === "subject")) continue;
      const values = ["eq", "neq"].includes(rule.operator) ? [rule.expected]
        : ["in", "not_in"].includes(rule.operator) && Array.isArray(rule.expected) ? rule.expected : [];
      for (const value of values) if (typeof value === "string" && value.trim() && value.length <= 160) options[rule.fact_key].add(value);
    }
    for (const tag of tags(row.taxonomy_tags)) {
      subjectInfo[tag.code] = { label: tag.name.trim(), group: tag.group ?? null };
      if (tag.group && typeof tag.group_name === "string" && tag.group_name.trim() && !subjectInfo[tag.group]) subjectInfo[tag.group] = { label: tag.group_name.trim(), group: null };
    }
  }
  const provider = (row: CatalogueRow) => {
    const name = row.details && typeof row.details === "object" ? (row.details as { provider_name?: unknown }).provider_name : null;
    return typeof name === "string" && name.trim() ? providerDisplayName(name.trim()) : null;
  };
  const universities = universityChoices(rows.map(row => ({ provider: provider(row), family: typeof row.family === "string" && row.family ? row.family : null, institutions: texts(row.institutions) })));
  for (const name of universities) options.institution.add(name);
  for (const code of Object.keys(subjectInfo)) options.subject.add(code);
  const askAbroad = rows.some(row => Array.isArray(row.origins) && row.origins.some(origin => origin && typeof origin === "object" && origin.origin === "from_abroad"));
  return { institution: [...options.institution].sort((a, b) => a.localeCompare(b, "de")), subject: [...options.subject].sort(), subjectInfo, askAbroad };
}
const studyPlans = ["exchange", "internship", "thesis", "graduation"];
const followUpLabels: Record<string, string> = {
  institution: "Check your university", degree_level: "Check your study level",
  subject: "Check your subject", semester_number: "Check your semester",
  milestone: "Check your study plan",
};

// Only revisit supported starter questions needed by a visible, unresolved result.
// Withheld answers are never turned into repeated prompts.
export function matchFollowUps(rows: CatalogueRow[], profile: MatchRequest["profile"], recommendations: MatchVariant[]): MatchFollowUp[] {
  const { institution, subject } = profileOptions(rows);
  const candidates: Record<string, (string | number)[]> = {
    institution, subject, degree_level: ["bachelor", "master", "doctoral"],
    semester_number: Array.from({ length: 20 }, (_, i) => i + 1),
    milestone: studyPlans,
  };
  const calls = new Map(rows.map((row) => {
    const call = callFromPayload(row.matching_payload);
    const idCounts = new Map<string, number>();
    for (const rule of call.requirements || []) idCounts.set(rule.id, (idCounts.get(rule.id) || 0) + 1);
    return [String(row.id), { call, idCounts }];
  }));
  const needed = new Set<string>();
  for (const item of recommendations) {
    if (item.status !== "needs_confirmation") continue;
    const entry = calls.get(item.call_id);
    if (!entry) continue;
    const { call, idCounts } = entry;
    if (item.route_id && call.routes?.find((route) => route.id === item.route_id)?.availability_status !== "available") continue;
    const rules = call.requirements || [];
    for (const rule of rules) {
      // Ambiguous criterion identities cannot safely point back to one question.
      if (idCounts.get(rule.id) !== 1) continue;
      const field = rule.fact_key;
      if (!followUpLabels[field] || (rule.track_id != null && rule.track_id !== item.track_id)) continue;
      if (profile.facts[field] && profile.facts[field].value_state !== "unknown") continue;
      if (!item.criteria.unknown.some((criterion) => criterion.id === rule.id && ["unknown", "missing_profile_fact"].includes(criterion.reason))) continue;
      // A valid answer from the actual form must be able to resolve this rule.
      if (candidates[field].some((value) => evaluateRequirement(rule, { facts: { [field]: {
        value, value_state: "known", confirmation_state: "confirmed",
      } } }).status !== "needs_confirmation")) needed.add(field);
    }
  }
  return Object.entries(followUpLabels).filter(([field]) => needed.has(field))
    .map(([field, label]) => ({ field, label }));
}

export function usesStudyPlan(rows: CatalogueRow[]): boolean {
  // Let the matcher select applicable rules, including route/group scope.
  // No student answers exist yet, so this only decides whether to offer a question.
  const profile = { facts: {} };
  const recommendations = recommend(rows.map((row) => callFromPayload(row.matching_payload)), profile)
    .map((item) => ({ ...item, title: "", slug: "" }));
  return matchFollowUps(rows, profile, recommendations).some((question) => question.field === "milestone");
}

export async function loadProfileOptions(env: ServingEnv | undefined) {
  try {
    const rows = await readMatchingCalls(env);
    if (rows.length > MATCHING_CAPACITY) throw new Error("Catalogue limit");
    return { state: "ready" as const, ...profileOptions(rows), usesStudyPlan: usesStudyPlan(rows) };
  } catch { return { state: "unavailable" as const, usesStudyPlan: false, institution: [] as string[], subject: [] as string[], subjectInfo: {} as SubjectInfo, askAbroad: false }; }
}
// The largest catalogue matching accepts; one more row than this fails closed
// (503), never silently truncated. Capacity test 2026-10-28: the 189 live calls
// duplicated to 1,000 took 36 ms for the options and study-plan check and 22 ms
// per match in Node; at 100 the chat had stopped working once 189 were live.
// The list loads the same catalogue (CATALOGUE_CAPACITY).
export const MATCHING_CAPACITY = CATALOGUE_CAPACITY;
// Each serving view once, as in the list (SERVING_VIEWS_ONCE): joined
// directly, the planner re-ran one view for every row of another (9.1 s at 56
// calls on 2026-10-27).
export const MATCHING_CALLS_QUERY = `with listed as materialized (select id, title, slug from recommendation_ready_calls),
    ${SERVING_VIEWS_ONCE}, ${SCOPE_LISTS}
    select r.id, r.title, r.slug, m.matching_payload, d.details, f.family, ${SCOPE_COLUMNS}
    from matching m join listed r on r.id = m.call_id
    join details d on d.call_id = r.id
    left join families f on f.call_id = r.id
    ${SCOPE_JOINS}
    order by r.id limit ${MATCHING_CAPACITY + 1}`;
export async function readMatchingCalls(env: ServingEnv | undefined): Promise<CatalogueRow[]> {
  if (demoMode) return (await import("./demo-catalogue.server")).demoCalls;
  const query = await servingQuery(env);
  // Bounded by MATCHING_CAPACITY; raise only after capacity testing, never silently truncate results.
  return await query(MATCHING_CALLS_QUERY, []) as CatalogueRow[];
}

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

export async function matchesResponse(request: Request, env: ServingEnv | undefined, read = readMatchingCalls): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (request.headers.get("Origin") !== new URL(request.url).origin) return json({ error: "Same-origin request required." }, 403);
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") return json({ error: "JSON required." }, 415);
  let profile: MatchRequest["profile"];
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Profile required." }, 400);
    let bytes = 0;
    let body = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 8192) { await reader.cancel(); return json({ error: "Profile too large." }, 413); }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    profile = parseProfile(JSON.parse(body));
  } catch { return json({ error: "Check the required profile answers and try again." }, 400); }
  try {
    const rows = await read(env);
    if (rows.length > MATCHING_CAPACITY) throw new Error("Catalogue exceeds tested capacity");
    const metadata = new Map(rows.map((row) => [String(row.id), row]));
    const options = profileOptions(rows);
    for (const key of ["institution", "subject"] as const) {
      if (profile.facts[key].value_state === "known" && !options[key].includes(String(profile.facts[key].value))) {
        profile.facts[key] = { value: null, value_state: "unknown", confirmation_state: "confirmed" };
      }
    }
    const calls = rows.map((row) => {
      if (String(row.matching_payload.id) !== String(row.id)) throw new Error("Invalid serving identity");
      return callFromPayload(row.matching_payload);
    });
    const callsById = new Map(calls.map((call) => [call.id, call]));
    const recommendations = recommend(calls, profile).map((variant) => {
      const row = metadata.get(variant.call_id)!;
      const call = callsById.get(variant.call_id)!;
      const window = selectedWindow(call, variant.track_id, variant.route_id);
      const timing = activityDetails(row.details).windows.find((detail) => detail.id === window?.id
        && detail.track_id === (window?.track_id ?? null) && detail.route_id === (window?.route_id ?? null));
      const source = publicDetails(row.details).sources[0] || null;
      return { ...variant, title: row.title, slug: row.slug,
        routeAvailable: call.routes?.some((route) => route.id === variant.route_id && route.availability_status === "available") ?? false,
        openingOn: window?.state === "announced" && timing?.opens_precision === "date_only" ? timing.opens_on : null,
        deadline: timing ? deadlineText(timing) : null,
        source,
      };
    });
    const followUps = matchFollowUps(rows, profile, recommendations).slice(0, 1);
    return json({ recommendations, ...(followUps.length ? { followUps } : {}) });
  } catch {
    // Never log or return profile data, credentials, or database errors.
    return json({ error: "Verified matching is temporarily unavailable. Please try again later." }, 503);
  }
}
