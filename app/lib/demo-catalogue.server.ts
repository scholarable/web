import type { ScholarshipSummary } from "./contracts";
import type { ServingPayload } from "./matching";
import { publicDetails } from "./public-details";
import type { ApplicationGuideData } from "./application-guide";
import { mentionedRuleIds, mentionedValues, type BrowseFilters } from "./browse";
import { audienceText, moneyText, timingText } from "./catalogue-copy";
import { cardFacts } from "./cards";

// Fictional development data. Never written to Neon or loaded by production builds.
const sampleCalls: { id: string; degree: string; subject: string; title: string; amountMinor: number; frequency: string; activity: string; plan?: string; opens?: string; semester?: number }[] = [
  { id: "demo-bachelor", degree: "bachelor", subject: "computer_science", title: "Sample: Undergraduate study support", amountMinor: 30000, frequency: "monthly", activity: "Study abroad" },
  { id: "demo-master", degree: "master", subject: "engineering", title: "Sample: Postgraduate research support", amountMinor: 50000, frequency: "monthly", activity: "Research placement" },
  { id: "demo-doctoral", degree: "doctoral", subject: "humanities", title: "Sample: Doctoral travel support", amountMinor: 75000, frequency: "one_time", activity: "Conference visit" },
  { id: "demo-exchange", degree: "bachelor", subject: "computer_science", title: "Sample: Exchange preparation grant", amountMinor: 40000, frequency: "monthly", activity: "Exchange", plan: "exchange", semester: 3, opens: "2028-04-01" },
];
export const demoCalls = sampleCalls.map((item) => {
  const matching_payload: ServingPayload = {
    id: item.id, recommendation_ready: true, serving_state: "ready",
    requirements: [
      { id: "degree", criterion_key: "degree_level", kind: "required", operator: "eq", value: { expected: item.degree }, label: "Sample study-level requirement" },
      { id: "institution", criterion_key: "institution", kind: "required", operator: "eq", value: { expected: "Example University" }, label: "Sample university requirement" },
      { id: "subject", criterion_key: "subject", kind: "required", operator: "eq", value: { expected: item.subject }, label: "Sample subject requirement" },
      ...(item.plan ? [{ id: "plan", criterion_key: "milestone", kind: "required", operator: "eq", value: { expected: item.plan }, label: "Sample exchange plan requirement" }] : []),
      ...(item.semester ? [{ id: "semester", criterion_key: "semester_number", kind: "required", operator: "gte", value: { expected: item.semester }, label: `Sample semester ${item.semester} or later requirement` }] : []),
    ],
    routes: [{ id: "demo-route", availability_status: "available" }],
    windows: [{ id: "demo-window", state: item.opens ? "announced" : "open" }],
  };
  const summary: ScholarshipSummary = { id: item.id, slug: item.id, title: item.title, provider: "Example University - fictional provider",
    funding: `${moneyText({ min: item.amountMinor, max: item.amountMinor, currency: "EUR", frequency: item.frequency })} (sample)`,
    deadline: `Sample · ${timingText({ applicationStatus: item.opens ? "planned" : "open", deadlineOn: item.opens ? "2028-05-26" : "2027-05-26" })}`,
    audience: audienceText({ degreeLevels: [item.degree], subjects: [item.subject], institutions: ["Example University"], subjectScope: "selected", institutionScope: "selected" }),
    status: item.opens ? "planned" : "open", lastChecked: null };
  return { ...summary, fundingNotes: null, subjects: [item.subject], institutions: ["Example University"], matching_payload, details: publicDetails({
    provider_name: "Example University - fictional provider", sources: [],
    tracks: [{ id: "demo-activity", label: item.activity }],
    routes: [{ id: "demo-route", track_id: null, label: "Sample application route (no real application)", route_type: "online_portal", availability_status: "unknown", url: null }],
    funding: [
      { id: "demo-award", track_id: null, condition_group_id: null, component_type: item.frequency === "one_time" ? "one_time_grant" : "living_stipend",
        amount_kind: "exact", amount_min_minor: item.amountMinor, amount_max_minor: item.amountMinor, currency: "EUR", percentage: null,
        frequency: item.frequency, duration_min_months: null, duration_max_months: item.frequency === "one_time" ? null : 12, starts_on: null, ends_on: null,
        is_conditional: false, description: "Fictional main award for testing this page." },
      { id: "demo-travel", track_id: "demo-activity", condition_group_id: null, component_type: "travel", amount_kind: "up_to", amount_min_minor: null,
        amount_max_minor: 50000, currency: "EUR", percentage: null, frequency: "per_trip", duration_min_months: null, duration_max_months: null,
        starts_on: null, ends_on: null, is_conditional: true, description: "Fictional travel allowance; only in this sample." },
      { id: "demo-advice", track_id: null, condition_group_id: null, component_type: "mentoring", amount_kind: "in_kind", amount_min_minor: null,
        amount_max_minor: null, currency: null, percentage: null, frequency: "in_kind", duration_min_months: null, duration_max_months: null,
        starts_on: null, ends_on: null, is_conditional: false, description: "Fictional advice sessions for testing the list." },
    ],
    windows: [{ id: "demo-window", track_id: null, route_id: null, window_type: "application", opens_on: item.opens || null,
      opens_precision: item.opens ? "date_only" : "unknown", deadline_on: item.opens ? "2028-05-26" : "2027-05-26",
      deadline_precision: "date_only", audience: "Fictional dates for testing the form only." }],
  }, matching_payload, { institution_scope: "selected", subject_scope: "selected" }) };
});

type DemoCall = (typeof demoCalls)[number];
function demoCard(row: DemoCall, today: string) {
  const window = row.details.windows[0];
  return cardFacts({ funding: row.details.funding, tracks: row.details.tracks, windows: row.details.windows,
    applicationStatus: row.status, effectiveState: null, deadlineOn: window?.deadline_on ?? null, summaryMoney: {},
    levels: mentionedValues(row.matching_payload, "degree_level"), levelRuleIds: mentionedRuleIds(row.matching_payload, "degree_level"),
    subjectScope: row.details.study_scope.subjects, institutionScope: row.details.study_scope.institutions }, today);
}
// The same study-level rule as the live list: a level never hides a call
// whose rules state none, and calls naming the level come first.
const levelFits = (row: DemoCall, level: string) => {
  const named = mentionedValues(row.matching_payload, "degree_level");
  return (named.includes(level) || !named.length) && !mentionedValues(row.matching_payload, "degree_level", ["exclusion"]).includes(level);
};
export function demoBrowse(filters: BrowseFilters, calls = demoCalls, today = "2026-10-20") {
  const rows = calls.filter(row => (!filters.openOnly || row.status === "open") && !filters.family
    && (!filters.degree || levelFits(row, filters.degree))
    && (!filters.subject || mentionedValues(row.matching_payload, "subject").includes(filters.subject))
    && `${row.title} ${row.details.provider_name}`.toLowerCase().includes(filters.search.toLowerCase()))
    .sort((a, b) => filters.degree ? Number(!mentionedValues(a.matching_payload, "degree_level").includes(filters.degree)) - Number(!mentionedValues(b.matching_payload, "degree_level").includes(filters.degree)) : 0);
  // Every match, like the live list; the page sorts, groups and pages them.
  // Each sample subject stands in as its own subject group.
  return { ...filters, today, subjects: [...new Set(calls.flatMap(row => mentionedValues(row.matching_payload, "subject")))].sort().slice(0, 100).map(value => ({ value, label: null })), state: "ready" as const,
    scholarships: rows.map(row => ({ ...row, card: demoCard(row, today), applyNow: row.status === "open", family: null,
      subjects: row.subjects.map(code => ({ code, name: code.replaceAll("_", " "), group: null })) })), total: rows.length };
}
export function demoDetail(slug: string, today = "2026-10-20") {
  const scholarship = demoCalls.find(row => row.slug === slug);
  return scholarship ? { state: "ready" as const, scholarship: { ...scholarship, card: demoCard(scholarship, today), today } } : { state: "missing" as const };
}

export function demoGuide(callId: string): ApplicationGuideData | null {
  if (!demoCalls.some(call => call.id === callId)) return null;
  return {
    packet_version: "fictional-demo-v1",
    questions_status: "complete",
    questions_status_explanation: "This fictional provider publishes its sample questions.",
    application_route_available: false,
    routes: [
      { id: "demo-route", track_id: null, route_type: "unavailable", submitted_by: "applicant", availability_status: "unavailable", name: "Sample application route", instructions: "No real application can be submitted.", source_version_id: "demo-v1", evidence_locator: "fictional sample" },
    ],
    windows: [
      { id: "demo-window", track_id: null, route_id: null, window_type: "application", audience_text: "Fictional applicants", opens_on: null, opens_on_precision: "unknown", deadline_on: "2027-05-26", deadline_time: null, deadline_timezone: null, deadline_precision: "date_only", recurrence_text: null, raw_text: "Fictional sample deadline: 26 May 2027.", source_version_id: "demo-v1", evidence_locator: "fictional sample" },
    ],
    questions: [
      { id: "sample-motivation", track_id: null, route_id: null, position: 1, prompt: "Why are you applying for this fictional scholarship?", help_text: "Use examples from this fictional scenario only.", response_kind: "long_text", requirement_kind: "required", condition_text: null, word_limit: 300, character_limit: null, options: [], source_version_id: "demo-v1", evidence_locator: "fictional sample" },
    ],
    documents: [
      { id: "sample-transcript", track_id: null, route_id: null, name: "Sample transcript", requirement_kind: "required", document_phase: "initial_application", submitted_by: "applicant", condition_text: null, instructions: "Prepare a fictional transcript for this sample workflow.", accepted_formats: ["PDF"], due_on: null, max_file_size_mb: 5, max_pages: null, max_words: null, max_characters: null, source_version_id: "demo-v1", evidence_locator: "fictional sample" },
      { id: "sample-reference", track_id: null, route_id: null, name: "Sample reference", requirement_kind: "conditional", document_phase: "initial_application", submitted_by: "referee", condition_text: "Only if requested in this fictional example.", instructions: null, accepted_formats: [], due_on: null, max_file_size_mb: null, max_pages: null, max_words: null, max_characters: null, source_version_id: "demo-v1", evidence_locator: "fictional sample" },
    ],
    steps: [
      { id: "sample-check", track_id: null, route_id: null, position: 1, title: "Check the sample criteria", instructions: "This is practice data, not an official provider instruction.", due_on: null, source_version_id: "demo-v1", evidence_locator: "fictional sample" },
      { id: "sample-prepare", track_id: null, route_id: null, position: 2, title: "Prepare sample documents", instructions: null, due_on: null, source_version_id: "demo-v1", evidence_locator: "fictional sample" },
    ],
    selection_stages: [
      { id: "sample-review", track_id: null, position: 1, stage_type: "document_review", title: "Sample document review", actor: "Fictional committee", description: "Fictional selection stage for testing the interface.", criteria_text: "Fictional criteria only.", criteria: { fictional: true }, expected_on: null, source_version_id: "demo-v1", evidence_locator: "fictional sample" },
    ],
    renewal_policies: [
      { id: "sample-renewal", track_id: null, policy_type: "no_renewal", initial_duration_months: 12, maximum_duration_months: 12, review_interval_months: null, maximum_renewals: 0, reapplication_allowed: false, requirements_text: "This fictional award does not renew.", extension_text: null, source_version_id: "demo-v1", evidence_locator: "fictional sample" },
    ],
    obligations: [],
  };
}
