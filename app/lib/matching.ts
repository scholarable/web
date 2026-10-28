export const MATCH = "match" as const;
export const MISMATCH = "mismatch" as const;
export const UNKNOWN = "needs_confirmation" as const;

type Status = typeof MATCH | typeof MISMATCH | typeof UNKNOWN;
type Kind = "required" | "preferred" | "exclusion" | "manual_review";
type Fact = { value?: unknown; value_state?: string; confirmation_state?: string };
export type Profile = { facts?: Record<string, Fact> };
export type Requirement = {
  id: string;
  group_id?: string | null;
  track_id?: string | null;
  fact_key: string;
  kind: Kind | string;
  operator: string;
  expected?: unknown;
  label: string;
};
type Group = { id: string; parent_id?: string | null; track_id?: string | null; logic?: string; applies_to?: string };
type Route = { id: string; track_id?: string | null; condition_group_id?: string | null; availability_status?: string };
type Window = { id?: string; track_id?: string | null; route_id?: string | null; state?: string };
export type MatchCall = {
  id: string;
  recommendation_ready?: boolean;
  serving_state?: string;
  tracks?: { id: string }[];
  groups?: Group[];
  requirements?: Requirement[];
  routes?: Route[];
  windows?: Window[];
};
export type Criterion = { id: string; label: string; kind: string; status: Status; reason: string };
export type MatchVariant = {
  call_id: string;
  track_id: string | null;
  route_id: string | null;
  status: Status;
  visible: boolean;
  actionable: boolean;
  window_state: string;
  criteria: { matched: Criterion[]; mismatched: Criterion[]; unknown: Criterion[] };
  preference_matches: number;
};
export type Variant = MatchVariant;

const applies = (item: { track_id?: string | null }, trackId: string | null) =>
  item.track_id == null || item.track_id === trackId;
const hard = (requirement: Requirement) => requirement.kind !== "preferred";
const MAX_CALLS = 1000; // MATCHING_CAPACITY in matches.server.ts
const MAX_TRACKS = 20;
const MAX_ROUTES_PER_TRACK = 20;
const MAX_VARIANTS = 100;
const MAX_GROUPS = 100;
const MAX_REQUIREMENTS = 500;
const MAX_WINDOWS = 500;
const MAX_GROUP_DEPTH = 20;
const unsupportedInput = (): never => { throw new RangeError("unsupported matching input"); };
const checkedList = <T>(value: T[] | undefined, limit: number): T[] => {
  if (value != null && !Array.isArray(value)) unsupportedInput();
  if ((value?.length || 0) > limit) unsupportedInput();
  return value || [];
};
const checkedObjects = (value: unknown[], limit: number): void => {
  if (value.length > limit || value.some((item) => item == null || typeof item !== "object" || Array.isArray(item))) unsupportedInput();
};
const numeric = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const scalar = (value: unknown): boolean => typeof value === "string" || typeof value === "boolean" || numeric(value);
const cmp = (operator: string, actual: unknown, expected: unknown): boolean => {
  if (["eq", "neq"].includes(operator) && (!scalar(actual) || !scalar(expected) || typeof actual !== typeof expected)) throw new TypeError("same-type scalars expected");
  if (operator === "eq") return actual === expected;
  if (operator === "neq") return actual !== expected;
  if (operator === "in" || operator === "not_in") {
    if (!scalar(actual) || !Array.isArray(expected) || !expected.length || !expected.every((value) => scalar(value) && typeof value === typeof actual)) throw new TypeError("same-type scalar list expected");
    const found = expected.includes(actual);
    return operator === "in" ? found : !found;
  }
  if (operator === "exists") {
    if (typeof expected !== "boolean") throw new TypeError("boolean expected");
    return (actual != null) === expected;
  }
  if (operator === "between") {
    if (!Array.isArray(expected) || expected.length !== 2) throw new TypeError("two bounds expected");
    if (!numeric(actual) || !expected.every(numeric) || expected[0] > expected[1]) throw new TypeError("ordered finite numeric bounds expected");
    return actual >= expected[0] && actual <= expected[1];
  }
  if (operator === "gte" || operator === "lte") {
    if (!numeric(actual) || !numeric(expected)) throw new TypeError("finite numeric comparison expected");
    return operator === "gte" ? actual >= expected : actual <= expected;
  }
  throw new TypeError("unsupported operator");
};
const combine = (statuses: Status[], logic: string | undefined): Status => {
  if (!statuses.length) return UNKNOWN;
  if (logic === "all") return statuses.includes(MISMATCH) ? MISMATCH : statuses.includes(UNKNOWN) ? UNKNOWN : MATCH;
  if (logic === "any") return statuses.includes(MATCH) ? MATCH : statuses.includes(UNKNOWN) ? UNKNOWN : MISMATCH;
  if (logic === "none") return statuses.includes(MATCH) ? MISMATCH : statuses.includes(UNKNOWN) ? UNKNOWN : MATCH;
  return UNKNOWN;
};

export function selectedWindow(call: MatchCall, trackId: string | null, routeId: string | null): Window | undefined {
  const windows = (call.windows || []).filter((window) => applies(window, trackId) && (window.route_id == null || window.route_id === routeId));
  const specificity = (window: Window) =>
    Number((window.track_id ?? null) === trackId) * 2 + Number((window.route_id ?? null) === routeId);
  const bestScope = Math.max(-1, ...windows.map(specificity));
  const candidates = windows.filter((window) => specificity(window) === bestScope);
  // IDs and list order do not establish which audience/window applies.
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function evaluateRequirement(requirement: Requirement, profile: Profile): Criterion {
  const result: Criterion = { id: requirement.id, label: requirement.label, kind: requirement.kind, status: UNKNOWN, reason: "unsupported_rule" };
  if (!(["required", "preferred", "exclusion", "manual_review"] as string[]).includes(requirement.kind)) return result;
  let raw: boolean;
  if (requirement.operator === "manual" || requirement.kind === "manual_review") return result;
  else if (requirement.operator === "any") raw = true;
  else {
    const fact = profile.facts?.[requirement.fact_key];
    if (!fact) return { ...result, reason: "missing_profile_fact" };
    if (fact.value_state !== "known") return { ...result, reason: fact.value_state || "unknown_profile_fact" };
    if (fact.confirmation_state !== "confirmed") return { ...result, reason: "unconfirmed_profile_fact" };
    try { raw = cmp(requirement.operator, fact.value, requirement.expected); }
    catch { return result; }
  }
  if (requirement.kind === "exclusion") raw = !raw;
  return { ...result, status: raw ? MATCH : MISMATCH, reason: raw ? "criterion_satisfied" : "criterion_not_satisfied" };
}

function evaluateGroup(
  groupId: string, groups: Map<string, Group>, requirements: Requirement[], profile: Profile, trackId: string | null, visiting: Set<string>,
): [Status, Criterion[], number] {
  if (visiting.size >= MAX_GROUP_DEPTH || visiting.has(groupId) || !groups.has(groupId)) return [UNKNOWN, [{ id: `group:${groupId}`, label: "Eligibility rule group is invalid", kind: "manual_review", status: UNKNOWN, reason: "unsupported_group" }], 1];
  const group = groups.get(groupId)!;
  const next = new Set(visiting).add(groupId);
  const criteria: Criterion[] = [];
  const statuses: Status[] = [];
  let hardCount = 0;
  for (const requirement of requirements) {
    if (requirement.group_id !== groupId || !applies(requirement, trackId)) continue;
    const result = evaluateRequirement(requirement, profile);
    criteria.push(result);
    if (hard(requirement)) { statuses.push(result.status); hardCount++; }
  }
  for (const child of groups.values()) {
    if (child.parent_id !== groupId || !applies(child, trackId)) continue;
    const [status, childCriteria, count] = evaluateGroup(child.id, groups, requirements, profile, trackId, next);
    criteria.push(...childCriteria);
    if (count) { statuses.push(status); hardCount += count; }
  }
  if (!criteria.length) return [UNKNOWN, [{ id: `group:${groupId}`, label: "Eligibility rule group is empty", kind: "manual_review", status: UNKNOWN, reason: "unsupported_group" }], 1];
  const status = combine(statuses, group.logic);
  if (status === MISMATCH && !criteria.some((criterion) => criterion.status === MISMATCH)) criteria.push({
    id: `group:${groupId}:result`, label: "A grouped eligibility condition is not satisfied", kind: "required", status: MISMATCH, reason: "group_not_satisfied",
  });
  return [status, criteria, hardCount];
}

function evaluateVariant(call: MatchCall, profile: Profile, track: { id: string } | null, route: Route | null): MatchVariant {
  const trackId = track?.id ?? null;
  const routeId = route?.id ?? null;
  const allGroups = call.groups || [];
  const excluded = new Set(allGroups.filter((group) => (group.applies_to || "application") !== "application" || !applies(group, trackId)).map((group) => group.id));
  for (;;) {
    const before = excluded.size;
    for (const group of allGroups) if (group.parent_id != null && excluded.has(group.parent_id)) excluded.add(group.id);
    if (before === excluded.size) break;
  }
  const groups = new Map(allGroups.filter((group) => !excluded.has(group.id)).map((group) => [group.id, group]));
  const requirements = (call.requirements || []).filter((requirement) => applies(requirement, trackId) && !excluded.has(requirement.group_id || ""));
  const routeOnly = new Set((call.routes || []).flatMap((candidate) => candidate.condition_group_id ? [candidate.condition_group_id] : []));
  for (;;) {
    const children = [...groups.values()].filter((group) => group.parent_id && routeOnly.has(group.parent_id)).map((group) => group.id);
    const before = routeOnly.size;
    children.forEach((id) => routeOnly.add(id));
    if (routeOnly.size === before) break;
  }
  const base = new Map([...groups].filter(([id]) => !routeOnly.has(id)));
  const criteria: Criterion[] = [];
  const statuses: Status[] = [];
  let hardCount = 0;
  const reachable = new Set<string>();
  const markReachable = (groupId: string, depth = 0): void => {
    if (depth >= MAX_GROUP_DEPTH || reachable.has(groupId) || !base.has(groupId)) return;
    reachable.add(groupId);
    for (const child of base.values()) if (child.parent_id === groupId) markReachable(child.id, depth + 1);
  };
  for (const group of base.values()) {
    if (group.parent_id != null) continue;
    markReachable(group.id);
    const [status, found, count] = evaluateGroup(group.id, base, requirements, profile, trackId, new Set());
    criteria.push(...found);
    if (count) { statuses.push(status); hardCount += count; }
  }
  for (const group of base.values()) {
    if (reachable.has(group.id)) continue;
    criteria.push({ id: `group:${group.id}`, label: "Eligibility rule group is invalid", kind: "manual_review", status: UNKNOWN, reason: "unsupported_group" });
    statuses.push(UNKNOWN);
    hardCount++;
  }
  for (const requirement of requirements) {
    if (requirement.group_id != null) {
      if (!groups.has(requirement.group_id)) {
        criteria.push({ id: requirement.id, label: requirement.label, kind: requirement.kind, status: UNKNOWN, reason: "unsupported_group" });
        if (hard(requirement)) { statuses.push(UNKNOWN); hardCount++; }
      }
      continue;
    }
    const result = evaluateRequirement(requirement, profile);
    criteria.push(result);
    if (hard(requirement)) { statuses.push(result.status); hardCount++; }
  }
  if (route?.condition_group_id) {
    const [status, found, count] = evaluateGroup(route.condition_group_id, groups, requirements, profile, trackId, new Set());
    criteria.push(...found);
    if (count) { statuses.push(status); hardCount += count; }
  }
  let status = combine(statuses, "all");
  if (!hardCount) {
    criteria.push({ id: "structured-eligibility", label: "Machine-readable eligibility rules are unavailable", kind: "manual_review", status: UNKNOWN, reason: "unsupported_call" });
    status = UNKNOWN;
  }
  const window = selectedWindow(call, trackId, routeId);
  const trusted = call.recommendation_ready === true && call.serving_state === "ready";
  const actionable = trusted && status === MATCH && route?.availability_status === "available" && ["open", "open_ended"].includes(window?.state || "unknown");
  const bucket = (wanted: Status) => criteria.filter((criterion) => criterion.status === wanted);
  return { call_id: call.id, track_id: trackId, route_id: routeId, status, visible: trusted, actionable, window_state: window?.state || "unknown", criteria: { matched: bucket(MATCH), mismatched: bucket(MISMATCH), unknown: bucket(UNKNOWN) }, preference_matches: criteria.filter((criterion) => criterion.kind === "preferred" && criterion.status === MATCH).length };
}

export const evaluateCall = (call: MatchCall, profile: Profile): MatchVariant[] => {
  if (call == null || typeof call !== "object" || typeof call.id !== "string") unsupportedInput();
  const tracks = checkedList(call.tracks, MAX_TRACKS);
  const groups = checkedList(call.groups, MAX_GROUPS);
  const requirements = checkedList(call.requirements, MAX_REQUIREMENTS);
  const routes = checkedList(call.routes, MAX_VARIANTS);
  const windows = checkedList(call.windows, MAX_WINDOWS);
  checkedObjects(tracks, MAX_TRACKS);
  checkedObjects(groups, MAX_GROUPS);
  checkedObjects(requirements, MAX_REQUIREMENTS);
  checkedObjects(routes, MAX_VARIANTS);
  checkedObjects(windows, MAX_WINDOWS);
  const variants: MatchVariant[] = [];
  for (const track of (tracks.length ? tracks : [null])) {
    const scopedRoutes = routes.filter((route) => applies(route, track?.id ?? null));
    if (scopedRoutes.length > MAX_ROUTES_PER_TRACK) unsupportedInput();
    for (const route of scopedRoutes.length ? scopedRoutes : [null]) {
      if (variants.length === MAX_VARIANTS) unsupportedInput();
      variants.push(evaluateVariant(call, profile, track, route));
    }
  }
  return variants;
};

export const recommend = (calls: MatchCall[], profile: Profile): MatchVariant[] => {
  const evaluated = checkedList(calls, MAX_CALLS).flatMap((call) => evaluateCall(call, profile));
  const potentiallyMatching = new Set(evaluated.filter((result) => result.status !== MISMATCH).map((result) => result.call_id));
  return evaluated.filter((result) => result.visible && (result.status !== MISMATCH || !potentiallyMatching.has(result.call_id))).sort((left, right) =>
    Number(right.actionable) - Number(left.actionable)
    || ({ [MATCH]: 0, [UNKNOWN]: 1, [MISMATCH]: 2 }[left.status] - { [MATCH]: 0, [UNKNOWN]: 1, [MISMATCH]: 2 }[right.status])
    || right.preference_matches - left.preference_matches || left.call_id.localeCompare(right.call_id) || (left.track_id || "").localeCompare(right.track_id || "") || (left.route_id || "").localeCompare(right.route_id || ""),
  );
};

type ServingRequirement = Omit<Requirement, "fact_key" | "expected"> & { criterion_key?: string; value?: unknown };
export type ServingPayload = Omit<MatchCall, "requirements"> & { requirements?: ServingRequirement[] };

export function callFromPayload(payload: ServingPayload): MatchCall {
  if (payload == null || typeof payload !== "object") unsupportedInput();
  const tracks = checkedList(payload.tracks, MAX_TRACKS);
  const groups = checkedList(payload.groups, MAX_GROUPS);
  const requirements = checkedList(payload.requirements, MAX_REQUIREMENTS);
  const routes = checkedList(payload.routes, MAX_VARIANTS);
  const windows = checkedList(payload.windows, MAX_WINDOWS);
  checkedObjects(tracks, MAX_TRACKS);
  checkedObjects(groups, MAX_GROUPS);
  checkedObjects(requirements, MAX_REQUIREMENTS);
  checkedObjects(routes, MAX_VARIANTS);
  checkedObjects(windows, MAX_WINDOWS);
  return { ...payload, tracks, groups, routes, windows, requirements: requirements.map((row) => {
    const atomic = row.operator === "any" || (!!row.value && typeof row.value === "object" && !Array.isArray(row.value) && Object.keys(row.value).length === 1 && "expected" in row.value);
    return { ...row, id: String(row.id || "invalid-requirement"), fact_key: row.criterion_key || "other", operator: atomic ? row.operator : "manual", expected: row.operator === "any" ? undefined : (row.value as { expected: unknown })?.expected };
  }) };
}

export const normaliseServingCall = callFromPayload;
