import type { StudyScope } from "./public-details";

// Student-facing wording for catalogue facts. Dates read as "31 October 2026",
// money as "€300 to €1,050 per month"; nothing here decides eligibility.
const dateOnlyFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const timestampFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });

export function longDate(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed.valueOf()) || (dateOnly && parsed.toISOString().slice(0, 10) !== value)) return null;
  return (dateOnly ? dateOnlyFormat : timestampFormat).format(parsed);
}

export const humanize = (value: string): string => value.replaceAll("_", " ");

const periodWords: Record<string, string> = { monthly: "per month", semester: "per semester", yearly: "per year", one_time: "one-time" };
const minorUnits = (value: unknown): number | null => {
  const amount = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? amount : null;
};
export type MoneyInput = { min?: unknown; max?: unknown; currency?: unknown; frequency?: unknown; durationMonths?: unknown };
export const NO_AMOUNT = "Amount on the provider page";

const currencyFormat = (currency: string): ((minor: number) => string) | null => {
  try {
    const formatter = new Intl.NumberFormat("en", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return minor => formatter.format(minor / 100);
  } catch { return null; }
};

export function moneyText(input: MoneyInput): string {
  const currency = typeof input.currency === "string" && /^[A-Za-z]{3}$/.test(input.currency.trim()) ? input.currency.trim().toUpperCase() : null;
  const min = minorUnits(input.min);
  const max = minorUnits(input.max);
  if (!currency || (min === null && max === null)) return NO_AMOUNT;
  const format = currencyFormat(currency);
  if (!format) return NO_AMOUNT;
  const amount = min !== null && max !== null
    ? (min === max ? format(min) : `${format(min)} to ${format(max)}`)
    : min !== null ? `From ${format(min)}` : `Up to ${format(max!)}`;
  const period = periodWords[String(input.frequency)] || "";
  const months = minorUnits(input.durationMonths);
  const duration = months ? `for ${months} ${months === 1 ? "month" : "months"}` : "";
  return [amount, period, duration].filter(Boolean).join(" ");
}

// One funding component as the provider states it. The label names the kind of
// benefit; the amount line says the price, "set by the provider", "not
// published" or "in kind", then the period and the duration the page gives.
const componentWords: Record<string, string> = {
  living_stipend: "Living stipend", one_time_grant: "One-time grant", tuition: "Tuition", travel: "Travel", insurance: "Insurance",
  research_allowance: "Research allowance", family_allowance: "Family allowance", childcare: "Childcare", accommodation: "Accommodation",
  equipment: "Equipment", fees: "Fees", mentoring: "Mentoring", events: "Events", network: "Network", coaching: "Coaching", other: "Other benefit",
};
const componentPeriodWords: Record<string, string> = { ...periodWords, per_day: "per day", per_trip: "per trip" };
export const componentLabel = (componentType: string): string => componentWords[componentType] || "Other benefit";
export type ComponentMoneyInput = {
  amount_kind: string; amount_min_minor: number | null; amount_max_minor: number | null; currency: string | null;
  percentage: number | null; frequency: string; duration_min_months: number | null; duration_max_months: number | null;
};
export function componentAmountText(component: ComponentMoneyInput): string {
  const format = component.currency ? currencyFormat(component.currency) : null;
  const min = component.amount_min_minor;
  const max = component.amount_max_minor;
  const priced = format && (min !== null || max !== null) && ["exact", "up_to", "range"].includes(component.amount_kind);
  const share = component.percentage !== null ? `${component.percentage}%` : null;
  let amount: string;
  if (priced) {
    amount = component.amount_kind === "up_to" || (min === null && max !== null) ? `Up to ${format(max ?? min!)}`
      : min !== null && max !== null && min !== max ? `${format(min)} to ${format(max)}`
      : min !== null ? format(min) : format(max!);
  } else if (component.amount_kind === "in_kind") amount = "In kind";
  else if (component.amount_kind === "not_published") amount = "Amount not published";
  else amount = share ? `${share}` : "Amount set by the provider";
  const period = priced || share ? componentPeriodWords[component.frequency] || "" : "";
  const low = component.duration_min_months;
  const high = component.duration_max_months;
  const unit = (count: number) => `${count} ${count === 1 ? "month" : "months"}`;
  const duration = low !== null && high !== null ? (low === high ? `for ${unit(low)}` : `for ${low} to ${unit(high)}`)
    : high !== null ? `for up to ${unit(high)}` : low !== null ? `for at least ${unit(low)}` : "";
  return [amount, period, duration].filter(Boolean).join(" ");
}

export type TimingInput = { applicationStatus?: unknown; effectiveState?: unknown; deadlineOn?: unknown };
export const NO_TIMING = "Timing on the provider page";
export const COUNTRY_TIMING = "Deadline depends on your country or group";

// Owner decisions (2026-10-13): a call closed now whose next round is known
// opens later; a deadline set per country or group says so.
export function timingText(input: TimingInput): string {
  if (input.effectiveState === "provider_defined") return COUNTRY_TIMING;
  const deadline = longDate(typeof input.deadlineOn === "string" ? input.deadlineOn : null);
  if (input.applicationStatus === "rolling") return deadline ? `Rolling applications until ${deadline}` : "Applications accepted on a rolling basis";
  if (!deadline) return NO_TIMING;
  return input.applicationStatus === "planned" ? `Opens later · next deadline ${deadline}` : `Deadline ${deadline}`;
}

const levelWords: Record<string, string> = { bachelor: "Bachelor's", master: "Master's", doctoral: "Doctoral" };
const listed = (values: string[], limit: number, humanized: boolean) => {
  const unique = [...new Set(values.map(value => value.trim()).filter(Boolean))];
  const shown = unique.slice(0, limit).map(value => humanized ? humanize(value) : value);
  const rest = unique.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
};
export type AudienceInput = { degreeLevels: string[]; subjects: string[]; institutions: string[]; subjectScope: StudyScope; institutionScope: StudyScope };

export function subjectsText(scope: StudyScope, subjects: string[], limit = 3): string {
  if (subjects.length) return `Subjects: ${listed(subjects, limit, true)}`;
  if (scope === "all") return "Any subject";
  if (scope === "provider_decides") return "Subjects decided by the provider";
  if (scope === "selected") return "Listed subjects only; see the official page";
  return "Subject not stated on the official page";
}
export function universitiesText(scope: StudyScope, institutions: string[], limit = 2): string {
  if (institutions.length) return listed(institutions, limit, false);
  if (scope === "all") return "Any state-recognised university";
  if (scope === "provider_decides") return "Universities decided by the provider";
  if (scope === "selected") return "Listed universities only; see the official page";
  return "University not stated on the official page";
}
export function levelsText(degreeLevels: string[]): string {
  const levels = [...new Set(degreeLevels.map(level => levelWords[level]).filter(Boolean))];
  return levels.length ? `${levels.join(" or ")} students` : "Study level not stated";
}
export function audienceText(input: AudienceInput): string {
  return [levelsText(input.degreeLevels), subjectsText(input.subjectScope, input.subjects), universitiesText(input.institutionScope, input.institutions)].join(" · ");
}
