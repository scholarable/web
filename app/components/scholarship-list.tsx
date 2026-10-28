import type { ReactNode } from "react";
import { Link } from "react-router";
import type { ScholarshipListItem } from "../lib/serving.server";
import { callFit, type CallFit } from "../lib/discovery-answers";
import type { MatchResult } from "../lib/contracts";
import { browseFilters, browseHref, PAGE_SIZE, type BrowseFilters } from "../lib/browse";
import { dateLong, daysWord, levelName, periodShort, scopesShort } from "../lib/copy-de";
import { providerDisplayName } from "../lib/provider-names";
import { NOT_LISTED, originFit, sameUniversity, subjectFit, subjectGroups, universityChoices, universityFit, type OriginTag, type ScopeFit } from "../lib/study-fit";
import { SaveButton } from "./save-button";
import { CheckIcon } from "./icons";

type SaveContext = { studentAccounts: boolean; signedIn: boolean; savedIds: string[] };
type Heading = "h2" | "h3";

// The list groups calls by what a student can do now. "Jetzt offen" is
// apply_now_calls; a call whose dates say open but which is not there (its
// re-check is due, or no route is open) follows in its own group.
export type StatusGroup = "open" | "check" | "soon" | "varies" | "closed";
export function statusGroup(item: ScholarshipListItem): StatusGroup {
  if (item.applyNow) return "open";
  const sort = item.card.timing.sort;
  return sort <= 1 ? "check" : sort === 2 ? "soon" : sort === 5 ? "closed" : "varies";
}
const GROUPS: { key: StatusGroup; title: string; hint: string }[] = [
  { key: "open", title: "Jetzt offen", hint: "" },
  { key: "check", title: "Offen laut letzter Prüfung", hint: "bitte beim Anbieter bestätigen" },
  { key: "soon", title: "Öffnet bald", hint: "Frist steht schon fest" },
  { key: "varies", title: "Termin je nach Gruppe", hint: "oder beim Anbieter" },
  { key: "closed", title: "Bewerbung geschlossen", hint: "nächste Runde beim Anbieter" },
];

// The card's status pill and the date under it, from the same timing as the
// scholarship page: "noch 6 Tage" in the urgent colour, "offen", "öffnet …".
export function statusPill(item: ScholarshipListItem): { tone: "urgent" | "open" | "later" | "varies" | "closed"; text: string; when: string; sub: string } {
  const { timing } = item.card;
  if (timing.sort <= 1) {
    const when = timing.deadline ? `${timing.cell.label === "Laufend bis" ? "laufend bis" : "bis"} ${timing.cell.value}` : "laufende Bewerbung";
    if (timing.cell.hot && timing.left !== null) return { tone: "urgent", text: timing.left === 0 ? "endet heute" : `noch ${daysWord(timing.left)}`, when, sub: "" };
    return { tone: "open", text: "offen", when, sub: timing.cell.sub };
  }
  if (timing.sort === 2) return { tone: "later", text: timing.label.replace(/^Öffnet/, "öffnet"), when: "", sub: timing.cell.sub };
  if (timing.sort === 5) return { tone: "closed", text: "geschlossen", when: "", sub: timing.deadline ? `Frist war ${timing.cell.value}` : "" };
  return { tone: "varies", text: timing.sort === 3 ? "Frist je nach Gruppe" : "Termin beim Anbieter", when: "", sub: "" };
}

// How the call relates to the student's chat answers: a rule-based
// comparison, never an eligibility decision.
function fitWords(fit: CallFit, level: string): { tone: "ok" | "no" | ""; text: string; sub: string } {
  if (fit.conflict) return { tone: "no", text: "Passt nicht", sub: fit.conflictLabel ? `laut Regel: ${fit.conflictLabel}` : "laut Regeln" };
  if (fit.level === "ok") return { tone: "ok", text: `${levelName(level)} passt`, sub: fit.unknown ? `${fit.unknown} ${fit.unknown === 1 ? "Punkt" : "Punkte"} selbst prüfen` : "" };
  if (fit.level === "un") return { tone: "", text: "Selbst prüfen", sub: "Studienniveau je nach Gruppe" };
  return { tone: "", text: "Nicht angegeben", sub: "Studienniveau, Seite prüfen" };
}

// The university, subject and "aus dem Ausland" answers against a call that is
// only for some (study-fit.ts); null without an answer or for a call open to all.
export type Scope = { university: ScopeFit | null; subject: ScopeFit | null; origin: ScopeFit | null };
const noScope: Scope = { university: null, subject: null, origin: null };
// Up to three names, then how many more ("+2"); the scholarship page lists all.
const someNames = (names: string[]) => `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`;
// "For whom" beyond the study level: the universities and subjects a call is
// only for, by name when the data has them, and how they compare with the
// chat's answers; otherwise the plain scope ("Alle Fächer").
export function scopeTags(item: ScholarshipListItem, scope: Scope): { text: string; tone: "on" | "quiet" | "fit" }[] {
  const tags: { text: string; tone: "on" | "quiet" | "fit" }[] = [];
  const { subjects, institutions } = item.card.study;
  if (subjects === "selected" && item.subjects.length) {
    if (scope.subject === "check") tags.push({ text: "Fach selbst prüfen", tone: "fit" });
    tags.push({ text: `Nur für: ${someNames(item.subjects.map(tag => tag.name))}`, tone: scope.subject === "own" ? "on" : "quiet" });
  } else tags.push(...scopesShort(subjects, "unknown").map(text => ({ text, tone: "quiet" as const })));
  if (institutions === "selected" && item.institutions.length) {
    if (scope.university === "own") tags.push({ text: "Deine Hochschule", tone: "on" });
    else {
      if (scope.university === "check") tags.push({ text: "Hochschule selbst prüfen", tone: "fit" });
      tags.push({ text: `Nur an: ${someNames(item.institutions.map(providerDisplayName))}`, tone: "quiet" });
    }
  } else tags.push(...scopesShort("unknown", institutions).map(text => ({ text, tone: "quiet" as const })));
  tags.push(...originTagsDe(item.origins, scope));
  return tags;
}
// Whom the call is for by where the applicant lives, when every declared row
// agrees: only applicants from abroad, or the groups an in_germany call names.
function originTagsDe(origins: OriginTag[], scope: Scope): { text: string; tone: "on" | "quiet" | "fit" }[] {
  if (!origins.length) return [];
  if (origins.every(row => row.origin === "from_abroad")) return [{ text: "Nur für Bewerbungen aus dem Ausland", tone: scope.origin === "own" ? "on" : "quiet" }];
  if (!origins.every(row => row.origin === "in_germany")) return [];
  const groups = [...new Set(origins.map(row => row.groups).filter((value): value is string => !!value))];
  return [...(scope.origin === "check" ? [{ text: "Selbst prüfen", tone: "fit" as const }] : []),
    ...(groups.length ? [{ text: `Nur für: ${groups.join(" · ")}`, tone: "quiet" as const }] : [])];
}

export function ScholarshipCard({ item, fit, level, filterLevel = "", save, title: Title = "h3", scope = noScope }: { item: ScholarshipListItem; fit: CallFit | null; level: string | null; filterLevel?: string; save: SaveContext; title?: "h3" | "h4"; scope?: Scope }) {
  const { money } = item.card;
  const pill = statusPill(item);
  const fitLine = fit && level ? fitWords(fit, level) : null;
  // "Passt zu dir" only when the call is not limited to universities, subjects or applicants the answers leave open.
  const fits = !!fit && !!level && fit.level === "ok" && !fit.conflict && ![scope.university, scope.subject, scope.origin].some(value => value === "check" || value === "other");
  const tags = scopeTags(item, scope);
  const unit = "text" in money.head ? "" : periodShort[money.head.unit] || money.head.unit;
  const more = [money.note, money.plus].filter(Boolean).join(" · ");
  const marked = filterLevel ? levelName(filterLevel) : "";
  return <li className="card">
    <div className="card-name">
      {fits && <span className="badge brand"><CheckIcon />Passt zu dir</span>}
      {fit && fit.conflict && <span className="badge no">Passt laut Regeln nicht</span>}
      <Title><Link to={`/scholarships/${item.slug}`}>{item.provider || item.title}</Link></Title>
      {item.provider && <p className="call-title">{item.title}</p>}
    </div>
    <div className="facts">
      <p className="card-status"><span className={`pill ${pill.tone}`}>{pill.text}</span>{pill.when && <span className="when">{pill.when}</span>}{pill.sub && <span className="sub">{pill.sub}</span>}</p>
      <p className="money">{"text" in money.head ? <span className="num text">{money.head.text}</span>
        : <>{money.head.pre && <span className="pre">{`${money.head.pre} `}</span>}<span className="num">{money.head.num}{unit && <small>{` ${unit}`}</small>}</span></>}
        {more && <span className="money-more">{more}</span>}
        {money.small && <span className="money-more">{money.small[0].toUpperCase() + money.small.slice(1)}</span>}</p>
    </div>
    {item.reviewOverdue && <p className="card-note">Zuletzt geprüft am {dateLong(item.lastChecked) ?? "unbekannten Datum"}. Bitte auf der Seite des Anbieters prüfen.</p>}
    <div className="card-foot">
      <p className="who">
        {fitLine && <><span className={`who-tag fit ${fitLine.tone}`}>{fitLine.text}</span>{fitLine.sub && <span className="who-tag quiet">{fitLine.sub}</span>}</>}
        {item.card.levelTags.map(tag => <span key={tag} className={`who-tag${tag === marked ? " on" : ""}`}>{tag}</span>)}
        {tags.map(tag => <span key={tag.text} className={`who-tag ${tag.tone === "fit" ? "fit " : tag.tone}`}>{tag.text}</span>)}
        {!fitLine && !item.card.levelTags.length && !tags.length && <span className="who-tag quiet">Siehe Bedingungen</span>}
      </p>
      <SaveButton variant="icon" callId={item.id} slug={item.slug} studentAccounts={save.studentAccounts} signedIn={save.signedIn} saved={save.savedIds.includes(item.id)} />
    </div>
  </li>;
}

const byDeadline = (a: ScholarshipListItem, b: ScholarshipListItem) => a.card.timing.sort - b.card.timing.sort
  || (a.card.timing.deadline || "9999").localeCompare(b.card.timing.deadline || "9999");
// "Nach Betrag": recurring money per month first, then one-off amounts, then
// calls without a published amount; the deadline breaks ties.
const byAmount = (a: ScholarshipListItem, b: ScholarshipListItem) => (b.card.money.perMonth ?? -1) - (a.card.money.perMonth ?? -1)
  || (b.card.money.amount ?? -1) - (a.card.money.amount ?? -1) || byDeadline(a, b);

// Sort and label, hide nothing: with a study level (from the chat or the
// level filter), the calls whose rules name it come first, grouped by status,
// then the calls that name no level; clear rule conflicts fold away below.
export function sortForStudent(items: ScholarshipListItem[], result: MatchResult | null, filterLevel = "", amount = false) {
  const fits = new Map(items.map(item => [item.id, result ? callFit(result, item.id, item.card.levelRuleIds) : null]));
  const sorted = [...items].sort(amount ? byAmount : byDeadline);
  const conflicts = sorted.filter(item => fits.get(item.id)?.conflict);
  const rest = sorted.filter(item => !fits.get(item.id)?.conflict);
  const named = (item: ScholarshipListItem) => {
    const fit = fits.get(item.id);
    return fit ? fit.level === "ok" : filterLevel ? item.card.levels.includes(filterLevel) : true;
  };
  return { fits, shown: rest.filter(named), unstated: rest.filter(item => !named(item)), conflicts };
}

// A declared scholarship family (public_call_families) is shown once: each
// university's Deutschlandstipendium is its own call with its own dates and
// rules, and a student can only apply at their own university (owner decision
// 2026-10-26). The grouped card is built from every listed member before the
// list is paged, stands where its best member would, counts the members the
// filters kept, and offers a "choose your university" field. Once the chat
// knows the university, that university's call stands on its own and the
// other members fold away together under the other universities (2026-10-28);
// a university without a call of its own folds the whole card there. A search
// or the family filter lists the members call by call.
const FAMILY_TITLES: Record<string, string> = { deutschlandstipendium: "Deutschlandstipendium" };
export const familyTitle = (family: string): string => FAMILY_TITLES[family] || family;
// The student's own call among a family's: the chat's answer against the
// provider's name and the verified institution names, in one form (study-fit.ts).
export function ownCall(members: ScholarshipListItem[], institution: string | null | undefined): ScholarshipListItem | null {
  if (!institution?.trim() || institution === NOT_LISTED) return null;
  return members.find(item => (!!item.provider && sameUniversity(item.provider, institution)) || item.institutions.some(name => sameUniversity(name, institution))) || null;
}
export function families(items: ScholarshipListItem[]): Map<string, ScholarshipListItem[]> {
  const map = new Map<string, ScholarshipListItem[]>();
  for (const item of items) if (item.family) map.set(item.family, [...(map.get(item.family) || []), item]);
  return map;
}
// The member the grouped card speaks for: open now first, then the earliest deadline.
export const familyLead = (members: ScholarshipListItem[]): ScholarshipListItem =>
  [...members].sort((a, b) => Number(b.applyNow) - Number(a.applyNow) || byDeadline(a, b))[0];
export type FamilyEntry = { kind: "family"; family: string; members: ScholarshipListItem[]; lead: ScholarshipListItem };
export type ListEntry = { kind: "call"; item: ScholarshipListItem } | FamilyEntry;
const sortItem = (entry: ListEntry) => entry.kind === "call" ? entry.item : entry.lead;
// Where a card goes: the list (level named, or not stated), or folded away
// below: another university's, another subject's, only for applicants from
// abroad, or a clear rule conflict.
type Place = "shown" | "unstated" | "university" | "subject" | "origin" | "conflicts";
export type ListAnswers = { filterLevel?: string; amount?: boolean; institution?: string | null; subject?: string | null; abroad?: string | null; grouped?: boolean };
// The whole list arranged for the chat's answers, before it is paged.
export function arrangeList(items: ScholarshipListItem[], result: MatchResult | null, { filterLevel = "", amount = false, institution = null, subject = null, abroad = null, grouped = true }: ListAnswers = {}) {
  const sorted = sortForStudent(items, result, filterLevel, amount);
  const conflicting = new Set(sorted.conflicts.map(item => item.id)), named = new Set(sorted.shown.map(item => item.id));
  // The universities the site can name for sure, from every listed call (study-fit.ts).
  const known = universityChoices(items);
  const groups = subjectGroups(items.map(item => item.subjects));
  const scopes = new Map<string, Scope>(items.map(item => [item.id, {
    university: universityFit({ ...item, scope: item.card.study.institutions }, institution, known),
    subject: subjectFit(item.card.study.subjects, item.subjects, subject, groups),
    origin: originFit(item.origins, abroad),
  }]));
  const placeOf = (item: ScholarshipListItem): Place => {
    const scope = scopes.get(item.id)!;
    return scope.university === "other" ? "university" : scope.subject === "other" ? "subject" : scope.origin === "other" ? "origin"
      : conflicting.has(item.id) ? "conflicts" : named.has(item.id) ? "shown" : "unstated";
  };
  const hidden = new Set<string>();
  const cards: (FamilyEntry & { place: Place })[] = [];
  if (grouped) for (const [family, members] of families(items)) {
    const mine = ownCall(members, institution);
    const rest = members.filter(member => member !== mine);
    if (!rest.length) continue;
    let place: Place, pool: ScholarshipListItem[];
    if (institution?.trim() && rest.every(member => scopes.get(member.id)!.university === "other")) { place = "university"; pool = rest; }
    else {
      // A member whose rules conflict with an answer folds away on its own, like
      // any other call; the grouped card counts the rest. All conflicting: the
      // whole family folds away as one card.
      const kept = rest.filter(member => !conflicting.has(member.id));
      place = !kept.length ? "conflicts" : kept.some(member => named.has(member.id)) ? "shown" : "unstated";
      pool = place === "conflicts" ? rest : kept;
    }
    for (const member of pool) hidden.add(member.id);
    cards.push({ kind: "family", family, members: pool, lead: familyLead(pool), place });
  }
  const part = (place: Place): ListEntry[] => [
    ...items.filter(item => !hidden.has(item.id) && placeOf(item) === place).map(item => ({ kind: "call" as const, item })),
    ...cards.filter(card => card.place === place).map(({ place: _place, ...card }) => card),
  ].sort((a, b) => (amount ? byAmount : byDeadline)(sortItem(a), sortItem(b)));
  return { fits: sorted.fits, scopes, shown: part("shown"), unstated: part("unstated"),
    otherUniversity: part("university"), otherSubject: part("subject"), otherOrigin: part("origin"), conflicts: part("conflicts") };
}

// The grouped card: the family's name, how many universities, the best
// member's status with how many are open now, the money, and the chooser as a
// plain GET form (/hochschule) that works before the page's script loads.
export function FamilyCard({ entry, fits, level, filterLevel = "", title: Title = "h3" }: { entry: FamilyEntry; fits: Map<string, CallFit | null>; level: string | null; filterLevel?: string; title?: "h3" | "h4" }) {
  const { family, members, lead } = entry;
  const count = members.length;
  const open = members.filter(member => member.applyNow);
  const pill = statusPill(lead);
  const { money } = lead.card;
  const unit = "text" in money.head ? "" : periodShort[money.head.unit] || money.head.unit;
  const named = level ? members.filter(member => fits.get(member.id)?.level === "ok").length : filterLevel ? members.filter(member => member.card.levels.includes(filterLevel)).length : 0;
  const choices = [...members].sort((a, b) => (a.provider || a.title).localeCompare(b.provider || b.title, "de"));
  const allHref = browseHref("/scholarships", browseFilters(new URL("https://scholarable.de/")), { family });
  return <li className="card family">
    <div className="card-name">
      <Title>{familyTitle(family)}</Title>
      <p className="call-title">{count === 1 ? "an 1 Hochschule" : `an ${count} Hochschulen`} · jede vergibt es selbst, mit eigenen Fristen und Regeln</p>
    </div>
    <div className="facts">
      <p className="card-status"><span className={`pill ${pill.tone}`}>{pill.text}</span>
        <span className="when">{open.length ? `${open.length} von ${count} gerade offen` : pill.when}</span>
        {open.length > 0 && lead.card.timing.deadline ? <span className="sub">{`nächste Frist ${lead.card.timing.cell.value}`}</span> : pill.sub && <span className="sub">{pill.sub}</span>}</p>
      <p className="money">{"text" in money.head ? <span className="num text">{money.head.text}</span>
        : <>{money.head.pre && <span className="pre">{`${money.head.pre} `}</span>}<span className="num">{money.head.num}{unit && <small>{` ${unit}`}</small>}</span></>}
        {money.note && <span className="money-more">{money.note}</span>}</p>
    </div>
    <form className="pick-uni" method="get" action="/hochschule">
      <label>Wähle deine Hochschule<select name="call" defaultValue="" required>
        <option value="">Hochschule auswählen …</option>
        {choices.map(member => <option key={member.id} value={member.slug}>{member.provider || member.title}</option>)}
      </select></label>
      <button className="btn dark sm">Zu meiner Hochschule</button>
    </form>
    <div className="card-foot">
      <p className="who">
        {level && named > 0 && <span className="who-tag fit ok">{`${levelName(level)} passt bei ${named} von ${count}`}</span>}
        {level && named === 0 && <span className="who-tag fit ">Nicht angegeben</span>}
        {!level && filterLevel && <span className="who-tag on">{levelName(filterLevel)}</span>}
        <span className="who-tag quiet">Nur an der eigenen Hochschule</span>
      </p>
      <Link className="btn link" to={allHref}>{`Alle ${count} einzeln ansehen`}</Link>
    </div>
  </li>;
}

// The line above the list: how many there are, how many are open now and the
// next deadline among those. Counts every listed call, on every page.
export function ListSummary({ items, total, soonOnly = false }: { items: ScholarshipListItem[]; total: number; soonOnly?: boolean }) {
  const count = soonOnly ? items.filter(item => statusGroup(item) === "soon").length : total;
  const open = items.filter(item => item.applyNow);
  const next = soonOnly ? undefined : open.filter(item => item.card.timing.left !== null).sort((a, b) => a.card.timing.left! - b.card.timing.left!)[0];
  const left = next?.card.timing.left ?? null;
  return <p className="summary"><b>{`${count} ${count === 1 ? "geprüftes Stipendium" : "geprüfte Stipendien"}`}</b>
    {!soonOnly && ` · ${open.length} jetzt offen`}
    {next && left !== null && <>{" · nächste Frist "}<span className={next.card.timing.cell.hot ? "hot" : undefined}>{`${next.card.timing.cell.value}, ${left === 0 ? "endet heute" : `noch ${daysWord(left)}`}`}</span></>}</p>;
}

// Filters as links, so they work before the page's script loads: status,
// then study level (tap again to clear), then the order.
export function ListTools({ path, filters, hash = "" }: { path: string; filters: BrowseFilters; hash?: string }) {
  const to = (change: Partial<BrowseFilters>) => browseHref(path, filters, change, hash);
  const status = filters.openOnly ? "open" : filters.soonOnly ? "soon" : "";
  const current = (on: boolean) => on ? "true" as const : undefined;
  return <div className="list-tools">
    <nav className="filter-chips" aria-label="Auswahl">
      <Link className="filter-chip" to={to({ openOnly: false, soonOnly: false })} aria-current={current(!status)} preventScrollReset>Alle</Link>
      <Link className="filter-chip" to={to({ openOnly: true, soonOnly: false })} aria-current={current(status === "open")} preventScrollReset>Jetzt offen</Link>
      <Link className="filter-chip" to={to({ openOnly: false, soonOnly: true })} aria-current={current(status === "soon")} preventScrollReset>Öffnet bald</Link>
      <span className="chip-gap" aria-hidden="true" />
      {(["bachelor", "master", "doctoral"] as const).map(level => <Link key={level} className="filter-chip" to={to({ degree: filters.degree === level ? "" : level })}
        aria-current={current(filters.degree === level)} preventScrollReset>{levelName(level)}</Link>)}
    </nav>
    <nav className="sort-by" aria-label="Sortieren"><span>Sortieren</span>
      <Link to={to({ byAmount: false })} aria-current={current(!filters.byAmount)} preventScrollReset>nach Frist</Link>
      <Link to={to({ byAmount: true })} aria-current={current(filters.byAmount)} preventScrollReset>nach Betrag</Link>
    </nav>
  </div>;
}

// count: the whole group's, when a page shows only part of it.
function Group({ id, title, hint, items, heading: H, card, count = items.length }: { id: string; title: string; hint: string; items: ListEntry[]; heading: Heading; card: (entry: ListEntry) => ReactNode; count?: number }) {
  return <section className="group" aria-labelledby={id}>
    <H className="group-h" id={id}>{`${title} `}<span className="count">{count}</span>{hint && <span className="hint">{` ${hint}`}</span>}</H>
    <ul className="cards">{items.map(card)}</ul>
  </section>;
}

// Pages of the arranged list: page is 0-based, href leads to another page.
// The start page shows the first page and links on ("Weitere Stipendien").
export type ListPages = { page: number; href: (page: number) => string; startPage?: boolean };
export function CardList({ items, result, level, filterLevel = "", soonOnly = false, byAmount: amount = false, heading = "h2", save, institution = null, subject = null, abroad = null, grouped = true, pages }: {
  items: ScholarshipListItem[]; result: MatchResult | null; level: string | null; filterLevel?: string; soonOnly?: boolean; byAmount?: boolean; heading?: Heading; save: SaveContext;
  // The chat's university, subject and "aus dem Ausland" answers, and whether declared families are shown as one card.
  institution?: string | null; subject?: string | null; abroad?: string | null; grouped?: boolean; pages?: ListPages;
}) {
  const visible = soonOnly ? items.filter(item => statusGroup(item) === "soon") : items;
  const { fits, scopes, shown, unstated, otherUniversity, otherSubject, otherOrigin, conflicts } = arrangeList(visible, result, { filterLevel, amount, institution, subject, abroad, grouped });
  const title = heading === "h2" ? "h3" : "h4";
  const card = (entry: ListEntry) => entry.kind === "family"
    ? <FamilyCard key={`family-${entry.family}`} entry={entry} fits={fits} level={level} filterLevel={filterLevel} title={title} />
    : <ScholarshipCard key={entry.item.id} item={entry.item} fit={fits.get(entry.item.id) || null} level={level} filterLevel={filterLevel} save={save} title={title} scope={scopes.get(entry.item.id)} />;
  if (!visible.length) return <div className="notice" role="status"><p>{soonOnly ? "Gerade öffnet keins dieser Stipendien bald. Schau unter „Alle“." : "Keine Stipendien für diese Auswahl."}</p></div>;
  // The list in reading order, then paged; the folded groups close the last page.
  const main = [...GROUPS.flatMap(group => shown.filter(entry => statusGroup(sortItem(entry)) === group.key).map(entry => ({ group: group.key as string, entry }))),
    ...unstated.map(entry => ({ group: "unstated", entry }))];
  const size = pages ? PAGE_SIZE : Math.max(main.length, 1);
  const count = Math.max(1, Math.ceil(main.length / size));
  const page = pages?.page ?? 0;
  if (pages && page >= count) return <div className="notice" role="status"><p>Diese Seite gibt es nicht. <Link to={pages.href(0)}>Zur ersten Seite</Link></p></div>;
  const slice = main.slice(page * size, (page + 1) * size);
  const on = (group: string) => slice.filter(row => row.group === group).map(row => row.entry);
  const total = (group: string) => main.filter(row => row.group === group).length;
  const last = page === count - 1;
  // Calls the chat could not place by level read "selbst prüfen" when some state levels per group.
  const perGroup = unstated.some(entry => entry.kind === "call" && fits.get(entry.item.id)?.level === "un");
  const folds: [string, string, ListEntry[]][] = [["university", "Nur für Studierende anderer Hochschulen", otherUniversity], ["subject", "Nur für andere Fächer", otherSubject],
    ["origin", "Nur für Bewerbungen aus dem Ausland", otherOrigin], ["conflicts", "Passt laut Regeln nicht zu deinen Angaben", conflicts]];
  return <div className="groups">
    {GROUPS.map(group => {
      const part = on(group.key);
      return part.length > 0 && <Group key={group.key} id={`group-${group.key}`} title={group.title} hint={group.hint} items={part} count={total(group.key)} heading={heading} card={card} />;
    })}
    {on("unstated").length > 0 && <Group id="group-unstated" title={perGroup ? "Studienniveau selbst prüfen" : "Studienniveau nicht angegeben"}
      hint={perGroup ? "nicht angegeben oder je nach Gruppe" : "Seite prüfen"} items={on("unstated")} count={total("unstated")} heading={heading} card={card} />}
    {last && folds.map(([key, text, list]) => list.length > 0 && <details key={key} className="mismatch-group"><summary>{`${text} (${list.length})`}</summary>
      <ul className="cards">{list.map(card)}</ul></details>)}
    {pages && count > 1 && (pages.startPage
      ? page === 0 && <nav className="pages" aria-label="Seiten"><Link rel="next" to={pages.href(1)}>Weitere Stipendien</Link></nav>
      : <nav className="pages" aria-label="Seiten">
        {page > 0 && <Link rel="prev" to={pages.href(page - 1)}>Vorherige Seite</Link>}
        <span>{`Seite ${page + 1} von ${count}`}</span>
        {page < count - 1 && <Link rel="next" to={pages.href(page + 1)}>Nächste Seite</Link>}
      </nav>)}
  </div>;
}
