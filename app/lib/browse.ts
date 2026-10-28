// The list loads every listed call that matches the filters, so the chat's
// sorting, the grouped families and every count cover the whole catalogue;
// pages of PAGE_SIZE cards come after sorting (190 calls on 2026-10-28; page
// one had held only the first 100 by deadline). A family's grouped card counts
// as one card. More than CATALOGUE_CAPACITY calls fail closed, never silently
// truncated; matching (MATCHING_CAPACITY) has the same limit.
export const PAGE_SIZE = 100;
export const MAX_PAGE = 1000;
export const CATALOGUE_CAPACITY = 1000;
export function browseFilters(url: URL) {
  const rawPage = Number(url.searchParams.get("page") || 0);
  return {
    search: url.searchParams.get("q")?.trim().slice(0, 120) || "",
    degree: ["bachelor", "master", "doctoral"].includes(url.searchParams.get("degree") || "") ? url.searchParams.get("degree")! : "",
    subject: url.searchParams.get("subject")?.trim().slice(0, 160) || "",
    openOnly: url.searchParams.get("status") === "open",
    // One declared scholarship family (public_call_families), listed call by
    // call instead of as the family's one grouped card.
    family: /^[a-z][a-z_]{1,39}$/.test(url.searchParams.get("family") || "") ? url.searchParams.get("family")! : "",
    // "Öffnet bald" and "nach Betrag" work on the loaded list, which holds
    // every match; "Jetzt offen" is apply_now_calls.
    soonOnly: url.searchParams.get("status") === "soon",
    byAmount: url.searchParams.get("sort") === "amount",
    page: Number.isInteger(rawPage) && rawPage >= 0 && rawPage <= MAX_PAGE ? rawPage : 0,
  };
}
export type BrowseFilters = ReturnType<typeof browseFilters>;
// The list's address with some choices changed; any change starts at page one.
export function browseHref(path: string, filters: BrowseFilters, change: Partial<BrowseFilters> = {}) {
  const next = { ...filters, page: 0, ...change };
  const query = new URLSearchParams();
  if (next.search) query.set("q", next.search);
  if (next.degree) query.set("degree", next.degree);
  if (next.subject) query.set("subject", next.subject);
  if (next.family) query.set("family", next.family);
  if (next.openOnly) query.set("status", "open"); else if (next.soonOnly) query.set("status", "soon");
  if (next.byAmount) query.set("sort", "amount");
  if (next.page > 0) query.set("page", String(next.page));
  return `${path}${query.size ? `?${query}` : ""}`;
}
export const browsePageHref = (filters: BrowseFilters, page: number) => browseHref("/scholarships", filters, { page });
// Browse facets describe positive structured mentions, not an eligibility decision.
// Negative, missing and unsupported rules never become positive facet values.
// A grouped rule counts when its group and every ancestor apply to the
// application and combine positively ("all of" or "any of" these): an
// alternative still names the level or subject. A "none of" group, a group for
// renewal or funding conditions, an orphaned, duplicated or circular group
// chain and a chain deeper than eight levels keep their rules out, the way the
// matching engine refuses to evaluate them.
const MAX_GROUP_DEPTH = 8;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function positiveGroupIds(payload: { groups?: unknown }): Set<string> {
  const groups = Array.isArray(payload.groups) && payload.groups.length <= 100 ? payload.groups.filter(isObject) : [];
  const byId = new Map<string, Record<string, unknown>>();
  const duplicated = new Set<string>();
  for (const group of groups) {
    if (typeof group.id !== "string") continue;
    if (byId.has(group.id)) duplicated.add(group.id);
    byId.set(group.id, group);
  }
  const positive = new Set<string>();
  for (const id of byId.keys()) {
    const seen = new Set<string>();
    let current: Record<string, unknown> | undefined = byId.get(id);
    let accepted = false;
    while (current && typeof current.id === "string") {
      if (seen.has(current.id) || duplicated.has(current.id) || seen.size >= MAX_GROUP_DEPTH) break;
      seen.add(current.id);
      if ((current.applies_to ?? "application") !== "application" || !["all", "any"].includes(String(current.logic))) break;
      if (current.parent_id == null) { accepted = true; break; }
      current = typeof current.parent_id === "string" ? byId.get(current.parent_id) : undefined;
    }
    if (accepted) positive.add(id);
  }
  return positive;
}
const POSITIVE = ["required", "preferred"];
// Structured mentions of one criterion: positive kinds by default, or the
// exclusions that name a value ("Doctoral candidates are excluded").
function mentionedRules(payload: { requirements?: unknown; groups?: unknown }, key: string, kinds: string[]) {
  if (!Array.isArray(payload.requirements)) return [];
  const positive = positiveGroupIds(payload);
  return payload.requirements.flatMap(rule => {
    if (!rule || rule.criterion_key !== key || !kinds.includes(rule.kind)) return [];
    if ((rule.group_id != null && !positive.has(String(rule.group_id))) || !rule.value || typeof rule.value !== "object" || Array.isArray(rule.value)
      || Object.keys(rule.value).length !== 1 || !("expected" in rule.value)) return [];
    const expected = rule.value.expected;
    const values = (rule.operator === "eq" ? [expected] : rule.operator === "in" && Array.isArray(expected) ? expected : [])
      .filter((value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 160);
    return values.length ? [{ id: String(rule.id ?? ""), values }] : [];
  });
}
export function mentionedValues(payload: { requirements?: unknown; groups?: unknown }, key: string, kinds = POSITIVE): string[] {
  return mentionedRules(payload, key, kinds).flatMap(rule => rule.values);
}
// Identifiers (never values) of the rules that state a study level, so a page
// can tell "your level is named" from "no level stated" in a match result.
export function mentionedRuleIds(payload: { requirements?: unknown; groups?: unknown }, key: string): string[] {
  return [...new Set(mentionedRules(payload, key, POSITIVE).map(rule => rule.id).filter(id => id && id.length <= 160))];
}
const facetRows = `jsonb_array_elements(coalesce(m.matching_payload->'requirements', '[]'::jsonb)) as rules(rule)
  cross join lateral jsonb_array_elements(case
    when rule->>'operator' = 'eq' then jsonb_build_array(rule->'value'->'expected')
    when rule->>'operator' = 'in' and jsonb_typeof(rule->'value'->'expected') = 'array' then rule->'value'->'expected'
    else '[]'::jsonb end) as facets(value)`;
// The SQL twin of positiveGroupIds: the rule's group chain, walked up to its
// root, must be a single acyclic chain of application groups combining
// positively; the group list is read from the same payload as the rule.
const groupList = `jsonb_array_elements(case when jsonb_typeof(m.matching_payload->'groups') = 'array'
  then m.matching_payload->'groups' else '[]'::jsonb end)`;
const positiveGroup = `exists (
  with recursive chain(node, depth, visited) as (
    select grp, 1, array[grp->>'id'] from ${groupList} as grp where grp->>'id' = rule->>'group_id'
    union all
    select parent, chain.depth + 1, chain.visited || (parent->>'id')
    from chain cross join ${groupList} as parent
    where chain.node->>'parent_id' is not null and parent->>'id' = chain.node->>'parent_id'
      and chain.depth < ${MAX_GROUP_DEPTH} and not (parent->>'id' = any(chain.visited))
  )
  select 1 from chain
  having count(*) > 0
    and count(*) = count(distinct node->>'id')
    and count(*) filter (where node->>'parent_id' is null) = 1
    and bool_and(coalesce(node->>'applies_to', 'application') = 'application' and node->>'logic' in ('all', 'any'))
)`;
const facetWhere = (kinds: string) => `(rule->>'group_id' is null or ${positiveGroup}) and jsonb_typeof(rule->'value') = 'object'
  and rule->'value' = jsonb_build_object('expected', rule->'value'->'expected')
  and rule->'value' ? 'expected' and rule->>'kind' in (${kinds}) and jsonb_typeof(value) = 'string'
  and length(value #>> '{}') between 1 and 160 and btrim(value #>> '{}') <> ''`;
const positiveFacet = facetWhere("'required', 'preferred'");
const excludedFacet = facetWhere("'exclusion'");
// The "Fach" choices: the listed calls' subjects from the taxonomy (the code is
// the value, the German name the label), then any subject value their rules name.
export const browseSubjectsQuery = `select subject, label from (
  select distinct s.code as subject, s.name as label from public_call_subjects s
  union
  select distinct value #>> '{}', null
  from matching_ready_calls m cross join lateral ${facetRows}
  where ${positiveFacet} and rule->>'criterion_key' = 'subject') as choices
  order by coalesce(label, subject), subject limit 101`;
export type SubjectChoice = { value: string; label: string | null };
// A call not limited to selected subjects stays under every subject filter:
// most foundations fund every field without saying so (owner decision 2026-10-10).
// One whose rules name a subject is listed only under that subject. A call
// limited to taxonomy subjects is listed under each of them, under their whole
// Fächergruppe, and, when it names a whole Fächergruppe, under every subject in it.
// Positive structured mentions for one criterion, as a JSON list; the key is one
// of three fixed identifiers, never user input.
const facetColumn = (key: "degree_level" | "subject" | "institution") => `(select coalesce(jsonb_agg(distinct (value #>> '{}')), '[]'::jsonb)
  from matching m cross join lateral ${facetRows}
  where m.call_id = r.id and ${positiveFacet} and rule->>'criterion_key' = '${key}')`;
// The SQL twin of mentionedRuleIds for study levels.
const levelRuleIdsColumn = `(select coalesce(jsonb_agg(distinct rule->>'id'), '[]'::jsonb)
  from matching m cross join lateral ${facetRows}
  where m.call_id = r.id and ${positiveFacet} and rule->>'criterion_key' = 'degree_level')`;
// Owner decision (2026-10-19): a study level never hides a call whose rules
// state no level; it comes after the calls that name the level. A call that
// names only other levels, or excludes this one, is left out. The value is
// the fixed parameter "$3" or empty, never user input.
const namesLevel = (facet: string, value: "$3" | "") => `exists (select 1 from matching m cross join lateral ${facetRows}
  where m.call_id = r.id and ${facet} and rule->>'criterion_key' = 'degree_level'${value ? ` and value #>> '{}' = ${value}` : ""})`;
// The Neon driver turns a `date` column into a JavaScript Date at local
// midnight, which the deadline wording cannot read; send the calendar day as text.
export const DEADLINE_AS_TEXT = "to_char(r.deadline_on, 'YYYY-MM-DD') as deadline_on";
// Each serving view is read once per query, into a materialized CTE. The
// planner misjudges their sizes and nested them, so matching_ready_calls ran
// again for every listed call: 9.3 s at 55 calls on 2026-10-27, growing with the
// square of the catalogue. The facet and filter subqueries read the CTEs.
export const SERVING_VIEWS_ONCE = `details as materialized (select call_id, details from public_call_details),
  families as materialized (select call_id, family, institutions from public_call_families),
  matching as materialized (select call_id, matching_payload from matching_ready_calls),
  universities as materialized (select call_id, name from public_call_institutions),
  subjects as materialized (select call_id, code, name, group_code, group_name from public_call_subjects),
  origins as materialized (select call_id, track_id, origin, groups_de from public_call_origins)`;
// Per call, the universities (public_call_institutions) and taxonomy subjects
// (public_call_subjects) of a call that is only for some, as JSON lists. A
// family's names (public_call_families) stand in when the call has none there.
// declared_origins: whom the call (or each track) is for by where the applicant
// lives now, from the reviewed declarations (public_call_origins).
export const SCOPE_LISTS = `named_universities as (select call_id, jsonb_agg(name order by name) as names from universities group by call_id),
  named_subjects as (select call_id, jsonb_agg(jsonb_build_object('code', code, 'name', name, 'group', group_code, 'group_name', group_name)
    order by name, code) as tags from subjects group by call_id),
  declared_origins as (select call_id, jsonb_agg(jsonb_build_object('track_id', track_id::text, 'origin', origin, 'groups', groups_de)
    order by track_id nulls first) as declared from origins group by call_id)`;
export const SCOPE_COLUMNS = `coalesce(nu.names, f.institutions, '[]'::jsonb) as institutions, coalesce(ns.tags, '[]'::jsonb) as taxonomy_tags,
      coalesce(od.declared, '[]'::jsonb) as origins`;
export const SCOPE_JOINS = `left join named_universities nu on nu.call_id = r.id
      left join named_subjects ns on ns.call_id = r.id
      left join declared_origins od on od.call_id = r.id`;
export function browseQuery(filters: BrowseFilters) {
  // Only this closed pair of identifiers is interpolated; user values stay parameters.
  // apply_now says whether a listed call is in apply_now_calls ("Jetzt offen").
  // Every match up to CATALOGUE_CAPACITY, plus one row to notice more; the page
  // sorts, groups and pages them.
  const view = filters.openOnly ? "apply_now_calls" : "recommendation_ready_calls";
  return {
    text: `with listed as materialized (select * from ${view}), ${SERVING_VIEWS_ONCE}, ${SCOPE_LISTS}${filters.openOnly ? "" : `,
      open_now as materialized (select id from apply_now_calls)`}
      select r.id, r.slug, r.title, r.application_status, r.effective_application_state, r.funding_amount_min_minor,
      r.funding_amount_max_minor, r.funding_currency, r.funding_frequency, r.funding_duration_months, ${DEADLINE_AS_TEXT}, r.last_verified_at, r.review_overdue,
      r.institution_scope, r.subject_scope, d.details->>'provider_name' as provider_name,
      ${facetColumn("degree_level")} as mentioned_degree_levels, ${facetColumn("subject")} as mentioned_subjects, ${facetColumn("institution")} as mentioned_institutions,
      ${levelRuleIdsColumn} as level_rule_ids, d.details->'funding' as funding_components, d.details->'tracks' as tracks, d.details->'windows' as windows,
      f.family, ${SCOPE_COLUMNS},
      ${filters.openOnly ? "true" : "r.id in (select a.id from open_now a)"} as apply_now
      from listed r join details d on d.call_id = r.id
      left join families f on f.call_id = r.id
      ${SCOPE_JOINS}
      where ($5 = '' or f.family = $5)
      and ($1 = '' or to_tsvector('simple', coalesce(r.title, '') || ' ' || coalesce(d.details->>'provider_name', ''))
        @@ websearch_to_tsquery('simple', $1))
      and ($3 = '' or ((${namesLevel(positiveFacet, "$3")} or not ${namesLevel(positiveFacet, "")}) and not ${namesLevel(excludedFacet, "$3")}))
      and ($4 = '' or exists (select 1 from matching m cross join lateral ${facetRows}
        where m.call_id = r.id and ${positiveFacet} and rule->>'criterion_key' = 'subject' and value #>> '{}' = $4)
        or exists (select 1 from subjects s where s.call_id = r.id
          and (s.code = $4 or s.group_code = $4
            or s.code in (select g.group_code from subjects g where g.code = $4)))
        or (r.subject_scope <> 'selected' and not exists (select 1 from matching m cross join lateral ${facetRows}
          where m.call_id = r.id and ${positiveFacet} and rule->>'criterion_key' = 'subject')))
      order by case when $3 <> '' and ${namesLevel(positiveFacet, "$3")} then 0 else 1 end, r.deadline_on nulls last, r.id limit $2`,
    values: [filters.search, CATALOGUE_CAPACITY + 1, filters.degree, filters.subject, filters.family],
  };
}
