import { activityDetails, type ActivityDetails } from "./activity-planning";

export type PublicDetails = ActivityDetails & {
  provider_name: string | null;
  sources: { label: string; url: string }[];
  funding: FundingComponent[];
  routes: { id: string; track_id: string | null; label: string; route_type: string; availability_status: string; url: string | null }[];
  study_scope: { institutions: StudyScope; subjects: StudyScope };
  eligibility: PublicEligibility;
};
export type PublicRequirement = { id: string; track_id: string | null; label: string; kind: "required" | "preferred" | "exclusion" | "manual_review" };
// A rule group as the provider's page combines its criteria: all of them, any
// one of them, or none of them; "applies_to" says when the group counts
// (application, renewal, ...). Groups nest; the page shows them as nested lists.
export type PublicRuleGroup = {
  id: string;
  track_id: string | null;
  logic: "all" | "any" | "none";
  applies_to: string;
  requirements: PublicRequirement[];
  groups: PublicRuleGroup[];
};
export type PublicEligibility = {
  has_unshown_requirements: boolean;
  requirements: PublicRequirement[];
  groups: PublicRuleGroup[];
};

export type StudyScope = "all" | "selected" | "provider_decides" | "unknown";
export const studyScope = (value: unknown): StudyScope =>
  value === "all" || value === "selected" || value === "provider_decides" ? value : "unknown";
// "unknown" means the official pages do not say (owner decision 2026-10-10);
// it is shown as not stated, never as "all".
export function studyScopeText(scope: StudyScope, kind: "subjects" | "universities", listed: string[] = []): string {
  const names = listed.map(value => kind === "subjects" ? value.replaceAll("_", " ") : value).join(", ");
  if (scope === "selected" && names) return kind === "subjects" ? `Only these subjects: ${names}` : `Only these universities: ${names}`;
  if (scope === "all") return kind === "subjects" ? "All subjects" : "Any state-recognised university";
  if (scope === "selected") return kind === "subjects" ? "Only the listed subjects; see the official page" : "Only the listed universities; see the official page";
  const stated = scope === "provider_decides" ? "Decided by the provider" : "Not stated by the provider; check the official page";
  return names ? `${stated}. The reviewed rules mention: ${names}` : stated;
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const shortText = (value: unknown): string | null => typeof value === "string" && value.length > 0 && value.length <= 500 ? value : null;

// Money components as the provider states them: a price, "set by the provider",
// "not published" or in kind. The page lists them; it never adds them up.
export const FUNDING_COMPONENT_TYPES = ["living_stipend", "one_time_grant", "tuition", "travel", "insurance", "research_allowance",
  "family_allowance", "childcare", "accommodation", "equipment", "fees", "mentoring", "events", "network", "coaching", "other"] as const;
export const FUNDING_AMOUNT_KINDS = ["exact", "up_to", "range", "provider_defined", "not_published", "in_kind"] as const;
export const FUNDING_FREQUENCIES = ["one_time", "monthly", "semester", "yearly", "per_day", "per_trip", "variable", "in_kind", "other"] as const;
export type FundingComponent = {
  id: string;
  track_id: string | null;
  condition_group_id: string | null;
  component_type: (typeof FUNDING_COMPONENT_TYPES)[number];
  amount_kind: (typeof FUNDING_AMOUNT_KINDS)[number];
  amount_min_minor: number | null;
  amount_max_minor: number | null;
  currency: string | null;
  percentage: number | null;
  frequency: (typeof FUNDING_FREQUENCIES)[number];
  duration_min_months: number | null;
  duration_max_months: number | null;
  starts_on: string | null;
  ends_on: string | null;
  is_conditional: boolean;
  description: string;
};
const minor = (value: unknown): number | null => {
  const amount = typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : value;
  return typeof amount === "number" && Number.isInteger(amount) && amount >= 0 && amount <= Number.MAX_SAFE_INTEGER ? amount : null;
};
const months = (value: unknown): number | null => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 600 ? value : null;
const isoDate = (value: unknown): string | null => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
const oneOf = <T extends readonly string[]>(options: T, value: unknown): T[number] | null =>
  typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T[number]) : null;
export function publicFunding(value: unknown): FundingComponent[] {
  if (!Array.isArray(value) || value.length > 100) return [];
  return value.flatMap((component): FundingComponent[] => {
    if (!object(component)) return [];
    const id = shortText(component.id);
    const componentType = oneOf(FUNDING_COMPONENT_TYPES, component.component_type);
    const amountKind = oneOf(FUNDING_AMOUNT_KINDS, component.amount_kind);
    const frequency = oneOf(FUNDING_FREQUENCIES, component.frequency);
    const description = typeof component.description === "string" && component.description.trim() && component.description.length <= 2000
      ? component.description.trim() : null;
    if (!id || !componentType || !amountKind || !frequency || !description) return [];
    if ((component.track_id != null && !shortText(component.track_id))
      || (component.condition_group_id != null && !shortText(component.condition_group_id))) return [];
    const currency = typeof component.currency === "string" && /^[A-Za-z]{3}$/.test(component.currency.trim()) ? component.currency.trim().toUpperCase() : null;
    const percentage = typeof component.percentage === "number" && component.percentage >= 0 && component.percentage <= 100 ? component.percentage
      : typeof component.percentage === "string" && /^\d{1,3}(\.\d{1,2})?$/.test(component.percentage) && Number(component.percentage) <= 100 ? Number(component.percentage) : null;
    const amountMin = minor(component.amount_min_minor);
    const amountMax = minor(component.amount_max_minor);
    if (amountMin !== null && amountMax !== null && amountMax < amountMin) return [];
    return [{
      id, track_id: shortText(component.track_id), condition_group_id: shortText(component.condition_group_id),
      component_type: componentType, amount_kind: amountKind,
      // An amount without a currency is not a price the page may show.
      amount_min_minor: currency ? amountMin : null, amount_max_minor: currency ? amountMax : null, currency, percentage, frequency,
      duration_min_months: months(component.duration_min_months), duration_max_months: months(component.duration_max_months),
      starts_on: isoDate(component.starts_on), ends_on: isoDate(component.ends_on),
      is_conditional: component.is_conditional === true, description,
    }];
  });
}

const MAX_GROUP_DEPTH = 8;
const GROUP_LOGIC = ["all", "any", "none"] as const;
// Only general labels leave the matching payload: never a rule's value.
const publicRequirement = (requirement: unknown): PublicRequirement | null => {
  if (!object(requirement) || !shortText(requirement.id) || !shortText(requirement.label)
    || !["required", "preferred", "exclusion", "manual_review"].includes(String(requirement.kind))) return null;
  return { id: String(requirement.id), track_id: shortText(requirement.track_id),
    label: String(requirement.label), kind: requirement.kind as PublicRequirement["kind"] };
};
export function publicEligibility(value: unknown): PublicEligibility {
  const payload = object(value) ? value : {};
  const unshown = { has_unshown_requirements: true, requirements: [], groups: [] };
  if ((Array.isArray(payload.groups) && payload.groups.length > 100) || (Array.isArray(payload.requirements) && payload.requirements.length > 500)) return unshown;
  const groups = new Map<string, Record<string, unknown>>();
  let malformedGroup = false;
  for (const group of Array.isArray(payload.groups) ? payload.groups : []) {
    const id = object(group) ? shortText(group.id) : null;
    if (!id || groups.has(id) || !GROUP_LOGIC.includes(group.logic as never) || (group.parent_id != null && !shortText(group.parent_id))
      || (group.track_id != null && !shortText(group.track_id))) { malformedGroup = true; continue; }
    groups.set(id, group);
  }
  let orphaned = false;
  const ungrouped: PublicRequirement[] = [];
  const grouped = new Map<string, PublicRequirement[]>();
  for (const requirement of Array.isArray(payload.requirements) ? payload.requirements : []) {
    const shown = publicRequirement(requirement);
    if (!shown || !object(requirement)) continue;
    if (requirement.group_id === null || requirement.group_id === undefined) { ungrouped.push(shown); continue; }
    const groupId = shortText(requirement.group_id);
    if (!groupId || !groups.has(groupId)) { orphaned = true; continue; }
    grouped.set(groupId, [...(grouped.get(groupId) || []), shown]);
  }
  const placed = new Set<string>();
  const tree = (parentId: string | null, depth: number): PublicRuleGroup[] => {
    if (depth >= MAX_GROUP_DEPTH) return [];
    return [...groups.values()].flatMap(group => {
      const id = String(group.id);
      if ((group.parent_id ?? null) !== parentId || placed.has(id)) return [];
      placed.add(id);
      return [{ id, track_id: shortText(group.track_id), logic: group.logic as PublicRuleGroup["logic"],
        applies_to: shortText(group.applies_to) || "application", requirements: grouped.get(id) || [], groups: tree(id, depth + 1) }];
    });
  };
  const roots = tree(null, 0);
  // A group outside the tree (its parent missing, a cycle, or too deep) and
  // its rules stay unshown; the page says so instead of guessing.
  const unplaced = [...groups.keys()].some(id => !placed.has(id));
  return { has_unshown_requirements: malformedGroup || orphaned || unplaced, requirements: ungrouped, groups: roots };
}

// External navigation only; never render credentials or executable URL schemes.
export function officialHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("https://") || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function publicDetails(value: unknown, matchingPayload?: unknown,
  scope?: { institution_scope?: unknown; subject_scope?: unknown }): PublicDetails {
  const details = value as Partial<PublicDetails> | null;
  return {
    ...activityDetails(value),
    study_scope: { institutions: studyScope(scope?.institution_scope), subjects: studyScope(scope?.subject_scope) },
    provider_name: typeof details?.provider_name === "string" ? details.provider_name : null,
    sources: Array.isArray(details?.sources) ? details.sources.flatMap((source) => {
      const url = officialHttpsUrl(source?.url);
      return url && typeof source.label === "string" ? [{ label: source.label, url }] : [];
    }) : [],
    funding: publicFunding(details?.funding),
    routes: Array.isArray(details?.routes) ? details.routes.flatMap((route) => {
      const url = officialHttpsUrl(route?.url);
      return route && typeof route.id === "string" && typeof route.label === "string"
        ? [{ id: route.id, label: route.label,
            track_id: typeof route.track_id === "string" ? route.track_id : null,
            route_type: typeof route.route_type === "string" ? route.route_type : "unspecified",
            availability_status: typeof route.availability_status === "string" ? route.availability_status : "unknown",
            url }] : [];
    }) : [],
    eligibility: publicEligibility(matchingPayload),
  };
}
