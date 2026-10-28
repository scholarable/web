import type { ActivityWindow } from "./activity-planning";
import type { FundingComponent, StudyScope } from "./public-details";

// German student-facing wording for catalogue facts: "25. Oktober 2026",
// "bis zu 855 € im Monat". It only states what the stored facts say; nothing
// here adds amounts up or decides eligibility.
const longFormat = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortFormat = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", timeZone: "UTC" });
const monthLongFormat = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
const stampFormat = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const validDay = (value: unknown): value is string => typeof value === "string" && isoDay.test(value)
  && !Number.isNaN(day(value).valueOf()) && day(value).toISOString().slice(0, 10) === value;

export function dateLong(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (validDay(value)) return longFormat.format(day(value));
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : stampFormat.format(parsed);
}
// "25. Okt.", with the year when it is not this year's.
export function dateShort(iso: string, today: string): string {
  return shortFormat.format(day(iso)) + (iso.slice(0, 4) !== today.slice(0, 4) ? ` ${iso.slice(0, 4)}` : "");
}
// An estimated date is a month the provider names ("voraussichtlich im Januar"),
// stored as its first day for an opening and its last for a deadline: it is
// shown as that month, never as a day. "Januar 2027"; "Jan.", with the year
// when it is not this year's.
export const monthLong = (iso: string): string => monthLongFormat.format(day(iso));
export function monthShort(iso: string, today: string): string {
  // The month as the short dates write it ("Feb."; alone, ICU writes "Feb").
  const month = shortFormat.formatToParts(day(iso)).find(part => part.type === "month")?.value ?? "";
  return month + (iso.slice(0, 4) !== today.slice(0, 4) ? ` ${iso.slice(0, 4)}` : "");
}
export const whenShort = (iso: string, estimated: boolean, today: string): string =>
  estimated ? monthShort(iso, today) : dateShort(iso, today);
export const daysUntil = (iso: string, today: string): number => Math.round((day(iso).valueOf() - day(today).valueOf()) / 86400000);
export const daysWord = (count: number): string => `${count} ${count === 1 ? "Tag" : "Tage"}`;
// "in 6 Tagen", "in 1 Tag", "heute".
export const inDays = (count: number): string => count === 0 ? "heute" : `in ${count} ${count === 1 ? "Tag" : "Tagen"}`;

const euroFormat = (currency: string) => {
  try {
    const whole = new Intl.NumberFormat("de-DE", { style: "currency", currency, maximumFractionDigits: 0 });
    const cents = new Intl.NumberFormat("de-DE", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (minor: number) => (minor % 100 ? cents : whole).format(minor / 100);
  } catch { return null; }
};

const periodWords: Record<string, string> = { monthly: "im Monat", semester: "pro Semester", yearly: "pro Jahr", one_time: "einmalig", per_day: "pro Tag", per_trip: "pro Reise" };
export const periodShort: Record<string, string> = { "im Monat": "/ Monat", "pro Semester": "/ Semester", "pro Jahr": "/ Jahr" };
const componentWords: Record<string, string> = {
  living_stipend: "Lebensunterhalt", one_time_grant: "Einmalzahlung", tuition: "Studiengebühren", travel: "Reisekosten",
  insurance: "Kranken- und Pflegeversicherung", research_allowance: "Forschungszuschuss", family_allowance: "Familienzuschlag",
  childcare: "Kinderbetreuung", accommodation: "Unterkunft", equipment: "Ausstattung", fees: "Gebühren", mentoring: "Mentoring",
  events: "Seminare und Programm", network: "Netzwerk", coaching: "Beratung", other: "Weitere Leistung",
};
export const componentLabelDe = (type: string): string => componentWords[type] || "Weitere Leistung";

export type AmountParts = { pre: string; num: string; unit: string } | { text: string };
type PricedInput = Pick<FundingComponent, "amount_kind" | "amount_min_minor" | "amount_max_minor" | "currency" | "percentage" | "frequency">;
const priced = (component: PricedInput) => !!component.currency && (component.amount_min_minor !== null || component.amount_max_minor !== null)
  && ["exact", "up_to", "range"].includes(component.amount_kind);
export function amountParts(component: PricedInput): AmountParts {
  const format = component.currency ? euroFormat(component.currency) : null;
  if (format && priced(component)) {
    const min = component.amount_min_minor, max = component.amount_max_minor, unit = periodWords[component.frequency] || "";
    if (component.amount_kind === "up_to" || min === null) return { pre: "bis zu", num: format((max ?? min)!), unit };
    if (max !== null && min !== max) return { pre: "", num: `${format(min)} bis ${format(max)}`, unit };
    return { pre: "", num: format(min), unit };
  }
  if (component.amount_kind === "in_kind") return { text: "Angebot ohne Geldbetrag" };
  if (component.amount_kind === "not_published") return { text: "Betrag nicht veröffentlicht" };
  if (component.percentage !== null) return { pre: "", num: `${String(component.percentage).replace(".", ",")} %`, unit: "" };
  return { text: "Betrag legt der Anbieter fest" };
}
export const amountTextDe = (component: PricedInput): string => {
  const parts = amountParts(component);
  return "text" in parts ? parts.text : [parts.pre, parts.num, parts.unit].filter(Boolean).join(" ");
};
export function durationDe(component: Pick<FundingComponent, "duration_min_months" | "duration_max_months">): string {
  const low = component.duration_min_months, high = component.duration_max_months;
  if (low && high) return low === high ? `für ${high} Monate` : `für ${low} bis ${high} Monate`;
  if (high) return `bis zu ${high} Monate`;
  if (low) return `mindestens ${low} Monate`;
  return "";
}
export const trackName = (tracks: { id: string; label: string }[], id: string | null): string =>
  tracks.find(track => track.id === id)?.label.replace(/\s*\(.*$/, "") || "Bestimmte Gruppe";

// amount and perMonth (minor units) only order a list "nach Betrag": the
// headline amount, at its upper end, and the same per month when it recurs.
export type MoneyLine = { head: AmountParts; note: string; plus: string; small: string; amount: number | null; perMonth: number | null };
const perMonthDivisor: Record<string, number> = { monthly: 1, semester: 6, yearly: 12 };
function amountValue(component: PricedInput): { amount: number | null; perMonth: number | null } {
  if (!priced(component)) return { amount: null, perMonth: null };
  const amount = (component.amount_max_minor ?? component.amount_min_minor)!;
  const divisor = perMonthDivisor[component.frequency];
  return { amount, perMonth: divisor ? Math.round(amount / divisor) : null };
}
// "je nach Einkommen" only when the stored description says the stipend depends
// on income. A bare mention is not enough: Deutschlandstipendium texts say the
// money is "nicht als Einkommen angerechnet" or "einkommensunabhängig", and the
// flat allowances are paid "unabhängig vom Einkommen der Eltern".
const INCOME_DEPENDENT: RegExp[] = [
  /einkommensabhängig/i,
  /(?<!un)abhängig (?:vom|von dem|von den|von ihrem|von seinem) (?:\S+ )?Einkommen/i,
  /je nach (?:dem )?(?:\S+ )?Einkommen/i,
  /richtet sich nach (?:dem )?(?:\S+ )?Einkommen/i,
  /(?<!unabhängig von )Einkommen und Vermögen/i,
  /(?<!in)depend(?:s|ing|ent)? on (?:the )?(?:\S+ )?income/i,
  /income[- ]dependent/i,
  /based on (?:the )?(?:\S+ )?income/i,
  /(?<!independent of (?:the )?)income and assets/i,
];
// A negation just before a phrase turns it around: "Not dependent on income"
// (Konstanz), "nicht abhängig vom Einkommen", "kein einkommensabhängiges
// Stipendium". Only the last few words of the same clause count, so a "nicht"
// in another clause ("muss nicht zurückgezahlt werden, je nach Einkommen") does not.
const NEGATION = /(?:^|[^\p{L}])(?:not|no|nicht|kein(?:e|er|en|em|es)?|unabhängig|independent(?:ly)?|regardless|irrespective|without)(?![\p{L}])/iu;
const negated = (text: string, at: number): boolean => {
  const clause = text.slice(0, at).split(/[.;:!?,()\n]/).pop() ?? "";
  return NEGATION.test(clause.trim().split(/\s+/).slice(-4).join(" "));
};
export const incomeDependent = (description: string): boolean => INCOME_DEPENDENT.some(pattern =>
  [...description.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))].some(match => !negated(description, match.index)));

// Which living stipend leads when a call stores several: recurring ones first,
// by what they pay per month (monthly first on a tie, so "300 € im Monat" beats
// the same money restated as "3.600 € pro Jahr"), then one-off or otherwise
// priced amounts by size, unpriced ones last. The same order as "nach Betrag"
// in the list, which puts non-recurring money after recurring money.
function stipendRank(item: FundingComponent): [number, number, number] {
  const { amount, perMonth } = amountValue(item);
  if (perMonth !== null) return [0, -perMonth, item.frequency === "monthly" ? 0 : 1];
  if (amount !== null) return [1, -amount, 0];
  return [2, 0, 0];
}
const byStipendRank = (a: FundingComponent, b: FundingComponent): number => {
  const [x, y] = [stipendRank(a), stipendRank(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};
// The money line: the living stipend first, with "je nach Einkommen" only when
// its stored description says so, then the flat amount every holder gets (an
// unconditional component). Track-specific money is shown for the first track
// and the others are named. Nothing is added up and nothing is invented.
export function moneyLine(funding: FundingComponent[], tracks: { id: string; label: string }[]): MoneyLine | null {
  if (!funding.length) return null;
  const scopeTrack = funding.some(item => item.component_type === "living_stipend" && item.track_id === null) ? null : (tracks[0]?.id ?? null);
  const inScope = (item: FundingComponent) => item.track_id === null || item.track_id === scopeTrack;
  const stipend = funding.filter(item => item.component_type === "living_stipend" && inScope(item)).sort(byStipendRank)[0];
  const others = funding.filter(item => item !== stipend && inScope(item) && item.amount_kind === "exact" && priced(item)
    && ["other", "one_time_grant"].includes(item.component_type));
  const flat = others.find(item => !item.is_conditional);
  const flatIf = others.find(item => item.is_conditional && item.frequency === "monthly");
  const income = stipend && incomeDependent(stipend.description) ? "je nach Einkommen" : "";
  const otherTracks = tracks.length > 1 && scopeTrack !== null
    ? tracks.filter(track => track.id !== scopeTrack && funding.some(item => item.track_id === track.id && item.component_type === "living_stipend")) : [];
  const extra = flat ? `+ ${amountTextDe(flat)} für alle` : flatIf ? `+ ${amountTextDe(flatIf)}, wenn zutreffend` : "";
  let head: AmountParts, note = "", plus = "", value: ReturnType<typeof amountValue> = { amount: null, perMonth: null };
  const small: string[] = [];
  if (stipend && priced(stipend)) { head = amountParts(stipend); note = income; plus = extra; value = amountValue(stipend); }
  else if (flat) { head = amountParts(flat); note = "für alle"; value = amountValue(flat); if (stipend) plus = `+ Grundstipendium${income ? ` ${income}` : ""}, Höhe beim Anbieter`; }
  else if (stipend) { head = { text: `Grundstipendium${income ? ` ${income}` : ""}` }; plus = extra; small.push("Höhe beim Anbieter"); }
  else {
    const first = funding.find(item => inScope(item) && priced(item));
    if (!first) return null;
    head = amountParts(first); value = amountValue(first);
  }
  const duration = stipend ? durationDe(stipend) : "";
  if (duration) small.push(duration);
  if (scopeTrack !== null) small.unshift(trackName(tracks, scopeTrack));
  if (otherTracks.length) small.push(`andere Beträge für ${otherTracks.map(track => trackName(tracks, track.id)).join(", ")}`);
  return { head, note, plus, small: small.join(" · "), ...value };
}
// The serving summary's single award, for calls without listed components.
export function moneyFromSummary(input: { min?: unknown; max?: unknown; currency?: unknown; frequency?: unknown; durationMonths?: unknown }): MoneyLine {
  const minor = (value: unknown) => { const amount = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value; return typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? amount : null; };
  const currency = typeof input.currency === "string" && /^[A-Za-z]{3}$/.test(input.currency.trim()) ? input.currency.trim().toUpperCase() : null;
  const min = minor(input.min), max = minor(input.max), months = minor(input.durationMonths);
  if (!currency || (min === null && max === null)) return { head: { text: "Betrag auf der Seite des Anbieters" }, note: "", plus: "", small: "", amount: null, perMonth: null };
  const award: PricedInput = { amount_kind: min !== null && max !== null && min !== max ? "range" : min === null ? "up_to" : "exact",
    amount_min_minor: min, amount_max_minor: max, currency, percentage: null, frequency: String(input.frequency) as FundingComponent["frequency"] };
  return { head: amountParts(award), note: "", plus: "", small: months ? `für ${months} ${months === 1 ? "Monat" : "Monate"}` : "", ...amountValue(award) };
}
export const moneyText = (money: MoneyLine): string => "text" in money.head ? money.head.text
  : [money.head.pre, money.head.num, money.head.unit].filter(Boolean).join(" ");

export type Timing = {
  pill: "urgent" | "open" | "later" | "closed";
  label: string;
  cell: { label: string; value: string; sub: string; hot: boolean };
  sort: number;
  deadline: string | null;
  opens: string | null;
  // An estimated deadline has no day count: its day is not published.
  left: number | null;
  deadlineEstimated: boolean;
  opensEstimated: boolean;
};
// Status, the next date and how close it is: open calls within 14 days are urgent.
export function timing(input: { applicationStatus: unknown; effectiveState: unknown; deadlineOn: unknown; windows: ActivityWindow[] }, today: string): Timing {
  const deadline = validDay(input.deadlineOn) ? input.deadlineOn : null;
  const window = deadline ? input.windows.find(item => item.window_type === "application" && item.deadline_on === deadline) : undefined;
  const estimatedDeadline = window?.deadline_precision === "estimated";
  const none = { deadline: null, opens: null, left: null, deadlineEstimated: false, opensEstimated: false };
  if (input.effectiveState === "provider_defined" || window?.deadline_precision === "provider_defined") {
    return { pill: "later", label: "Frist je nach Gruppe", cell: { label: "Frist", value: "je nach Gruppe", sub: "", hot: false }, sort: 3, ...none };
  }
  // A call whose round is over (the calendar moved past its deadline, or it is
  // stored closed) says so; it never shows a negative count of days.
  const closed = { pill: "closed" as const, label: "Bewerbung geschlossen", sort: 5, opens: null, left: null,
    deadlineEstimated: estimatedDeadline, opensEstimated: false };
  if (input.effectiveState === "closed" || input.applicationStatus === "closed") {
    return { ...closed, cell: { label: "Frist", value: deadline ? whenShort(deadline, estimatedDeadline, today) : "vorbei", sub: deadline ? "vorbei" : "", hot: false }, deadline };
  }
  if (!deadline) {
    const rolling = input.applicationStatus === "rolling";
    return { pill: rolling ? "open" : "later", label: rolling ? "Laufende Bewerbung" : "Termin noch offen",
      cell: { label: "Frist", value: rolling ? "laufend" : "beim Anbieter", sub: "", hot: false }, sort: rolling ? 1 : 4, ...none };
  }
  const left = daysUntil(deadline, today);
  if (left < 0) return { ...closed, cell: { label: "Frist", value: whenShort(deadline, estimatedDeadline, today), sub: "vorbei", hot: false }, deadline };
  const deadlineShort = estimatedDeadline ? `im ${monthShort(deadline, today)}` : dateShort(deadline, today);
  const opensOn = window?.opens_on && window.opens_on > today ? window.opens_on : null;
  if (input.applicationStatus === "planned" || opensOn) {
    const estimatedOpening = !!opensOn && window?.opens_precision === "estimated";
    const opensShort = opensOn ? estimatedOpening ? `im ${monthShort(opensOn, today)}` : dateShort(opensOn, today) : "später";
    return { pill: "later", label: `Öffnet ${opensShort}`,
      cell: { label: "Öffnet", value: opensShort, sub: `Frist ${deadlineShort}`, hot: false },
      sort: 2, deadline, opens: opensOn, left: null, deadlineEstimated: estimatedDeadline, opensEstimated: estimatedOpening };
  }
  const rolling = input.applicationStatus === "rolling";
  const urgent = !estimatedDeadline && left <= 14;
  return { pill: urgent ? "urgent" : "open", label: rolling ? "Laufende Bewerbung" : "Bewerbung offen",
    cell: { label: rolling ? "Laufend bis" : "Frist", value: whenShort(deadline, estimatedDeadline, today),
      sub: estimatedDeadline ? "Tag nicht angegeben" : left === 0 ? "endet heute" : `noch ${daysWord(left)}`, hot: urgent },
    sort: urgent ? 0 : 1, deadline, opens: null, left: estimatedDeadline ? null : left, deadlineEstimated: estimatedDeadline, opensEstimated: false };
}

// One application window's deadline as the provider states it, for the
// scholarship page; the quiet part says what is not confirmed.
export function deadlineWords(window: ActivityWindow | undefined): { text: string; quiet: string } {
  if (!window) return { text: "Frist auf der Seite des Anbieters", quiet: "" };
  if (window.deadline_precision === "provider_defined") return { text: "Frist hängt von deinem Land oder deiner Gruppe ab", quiet: "" };
  if (window.deadline_precision === "rolling") return { text: window.deadline_on ? `laufend bis ${dateLong(window.deadline_on)}` : "Laufende Bewerbung", quiet: "" };
  if (!window.deadline_on) return { text: "Frist beim Anbieter bestätigen", quiet: "" };
  const text = dateLong(window.deadline_on) || window.deadline_on;
  const time = window.deadline_time?.slice(0, 5);
  if (window.deadline_precision === "estimated") return { text: `voraussichtlich im ${monthLong(window.deadline_on)}`, quiet: "Genauer Tag nicht angegeben, bitte beim Anbieter prüfen" };
  if (window.deadline_precision === "exact_time" && time) return { text: `${text}, ${time} Uhr`, quiet: window.deadline_timezone ? `Zeitzone ${window.deadline_timezone}` : "" };
  if (window.deadline_precision === "exact_local_time" && time) return { text: `${text}, ${time} Uhr`, quiet: "Zeitzone nicht angegeben" };
  if (window.deadline_precision === "date_only") return { text, quiet: "Uhrzeit nicht angegeben" };
  return { text: "Frist beim Anbieter bestätigen", quiet: "" };
}
export function openingWords(window: ActivityWindow): string {
  if (window.opens_on && window.opens_precision === "date_only") return `Öffnet am ${dateLong(window.opens_on)}.`;
  if (window.opens_on && window.opens_precision === "estimated") return `Öffnet voraussichtlich im ${monthLong(window.opens_on)}, bitte beim Anbieter prüfen.`;
  if (window.opens_precision === "not_announced") return "Die letzte Runde ist vorbei, der nächste Start ist noch nicht bekannt.";
  return "Ein genauer Starttermin ist nicht bestätigt.";
}

const levelNames: Record<string, string> = { bachelor: "Bachelor", master: "Master", doctoral: "Promotion", diplom: "Diplom", magister: "Magister", staatsexamen: "Staatsexamen" };
export const levelName = (level: string): string => levelNames[level] || level;
export function levelsDe(levels: string[]): string[] {
  return [...new Set(levels.filter(level => levelNames[level]).map(level => levelNames[level]))];
}
// The card's level tags in the order students know them, the three list
// filters first: "Bachelor", "Master", "Staatsexamen", "+2".
const levelOrder = ["bachelor", "master", "doctoral", "staatsexamen", "diplom", "magister"];
export function levelTagsDe(levels: string[], max = 3): string[] {
  const names = levelOrder.filter(level => levels.includes(level)).map(level => levelNames[level]);
  return names.length > max ? [...names.slice(0, max), `+${names.length - max}`] : names;
}
// Subject and university scope in a few words. Unknown scopes stay unsaid; the page says "nicht angegeben".
export function scopesShort(subjectScope: StudyScope, institutionScope: StudyScope): string[] {
  const out: string[] = [];
  if (subjectScope === "all") out.push("Alle Fächer"); else if (subjectScope === "selected") out.push("Bestimmte Fächer");
  else if (subjectScope === "provider_decides") out.push("Fächer legt der Anbieter fest");
  if (institutionScope === "all") out.push("Alle Hochschulen"); else if (institutionScope === "selected") out.push("Bestimmte Hochschulen");
  else if (institutionScope === "provider_decides") out.push("Hochschulen legt der Anbieter fest");
  return out;
}
// The short "for whom": stated study levels, then subject and university scope.
export function audienceShort(levels: string[], subjectScope: StudyScope, institutionScope: StudyScope): string[] {
  const names = levelsDe(levels), out: string[] = [];
  if (names.length) out.push(names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", "));
  return [...out, ...scopesShort(subjectScope, institutionScope)];
}
// Taxonomy subject names contain commas ("Physik, Astronomie"), so subjects are
// separated by a middle dot.
export function scopeDe(scope: StudyScope, kind: "subjects" | "universities", listed: string[] = []): string {
  const names = kind === "subjects" ? listed.map(value => value.replaceAll("_", " ")).join(" · ") : listed.join(", ");
  if (scope === "selected" && names) return kind === "subjects" ? `Nur diese Fächer: ${names}` : `Nur diese Hochschulen: ${names}`;
  if (scope === "all") return kind === "subjects" ? "Alle Fächer" : "Alle staatlich anerkannten Hochschulen";
  if (scope === "selected") return kind === "subjects" ? "Nur bestimmte Fächer, siehe Seite des Anbieters" : "Nur bestimmte Hochschulen, siehe Seite des Anbieters";
  const stated = scope === "provider_decides" ? "Legt der Anbieter fest" : "Nicht angegeben";
  return names ? `${stated}. Die Regeln nennen: ${names}` : stated;
}

// Names for the guide's and the page's stored categories; anything new reads as stored.
const named = (words: Record<string, string>) => (value: string): string => words[value] || value.replaceAll("_", " ");
export const documentPhaseDe = named({ initial_application: "Mit der Bewerbung", after_shortlist: "Nach der Vorauswahl", continuation: "Für die Weiterförderung", interview: "Zum Auswahlgespräch", other: "Zu einem anderen Zeitpunkt" });
export const submittedByDe = named({ applicant: "von dir", referee: "von einer Referenzperson", institution: "von der Hochschule", provider: "vom Anbieter", other: "von jemand anderem" });
export const obligationDe = named({ change_notification: "Änderungen melden", reporting: "Berichte", documentation: "Nachweise", attendance: "Teilnahme",
  permitted_use: "Verwendung des Geldes", funding_disclosure: "Andere Förderung angeben", other: "Weitere Pflicht" });
export const policyDe = named({ reapplication: "Neu bewerben", no_renewal: "Keine Verlängerung", renewal: "Verlängerung", fixed_term: "Feste Laufzeit",
  automatic_continuation: "Läuft automatisch weiter", continuation_review: "Prüfung für die Weiterförderung", renewal_application: "Verlängerung beantragen",
  mobility_cap: "Grenze für Auslandszeiten", unknown: "Weitere Regel" });
export const routeTypeDe = named({ portal: "Online-Portal", online_portal: "Online-Portal", email: "E-Mail", nomination: "Vorschlag durch die Hochschule", post: "Post",
  postal: "Post", home_institution: "über die eigene Hochschule", provider_contact: "Kontakt zum Anbieter", other: "anderer Weg", unavailable: "Nicht möglich" });
export const availabilityDe = named({ available: "offen", not_announced: "noch nicht angekündigt", unknown: "nicht bestätigt", provider_defined: "legt der Anbieter fest", unavailable: "gerade nicht möglich" });
export const windowTypeDe = named({ application: "Bewerbung", renewal: "Verlängerung", late_document: "Unterlagen nachreichen" });
export const requirementKindDe = (kind: "required" | "conditional" | "optional") => kind === "conditional" ? "Wenn zutreffend" : kind === "optional" ? "Optional" : "Pflicht";

// The student's own progress words, shared by Gemerkt, the workspace and the answer library.
export const stagesDe = [["planned", "Geplant"], ["preparing", "In Vorbereitung"], ["submitted", "Abgeschickt"], ["interview", "Auswahlgespräch"], ["decision", "Warte auf Entscheidung"], ["completed", "Abgeschlossen"]] as const;
export const outcomesDe = [["accepted", "Angenommen"], ["rejected", "Nicht ausgewählt"], ["waitlisted", "Warteliste"], ["withdrawn", "Zurückgezogen"]] as const;
export const draftStateDe = named({ not_started: "Nicht begonnen", drafting: "In Arbeit", ready_for_review: "Bereit zum Prüfen", approved: "Freigegeben" });
export const documentStateDe = named({ not_started: "Nicht begonnen", ready: "Fertig", not_applicable: "Trifft nicht zu" });
export const themeDe = named({ motivation: "Motivation", leadership: "Verantwortung", challenge: "Herausforderung", impact: "Wirkung", community: "Engagement",
  financial_context: "Finanzielle Lage", study_goals: "Studienziele", career_plans: "Berufspläne" });
export const writingActionDe = named({ draft: "Entwurf schreiben", critique: "Rückmeldung geben", rewrite: "Umformulieren", shorten: "Kürzen", tone: "Ton anpassen" });
// A saved moment, the same on the server and in the browser.
export const dateTimeDe = (iso: string) => new Date(iso).toLocaleString("de-DE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" });

// A source link reads as its address, "uni-nord.example/…/bewerbungsschritte-und-faq":
// the stored source titles carry internal keys, and the address is what the student will see.
export function sourceLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const parts = parsed.pathname.split("/").filter(Boolean).map(part => { try { return decodeURIComponent(part); } catch { return part; } });
    if (!parts.length) return host;
    const last = parts[parts.length - 1].replace(/\.(html?|php|aspx?)$/i, "").slice(0, 60);
    return parts.length === 1 ? `${host}/${last}` : `${host}/…/${last}`;
  } catch { return url; }
}
