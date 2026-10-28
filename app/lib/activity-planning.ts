import { longDate } from "./catalogue-copy";

export type ActivityWindow = {
  id: string; track_id: string | null; route_id: string | null;
  window_type: string; audience: string | null; provider_text: string;
  opens_on: string | null; opens_precision: string;
  deadline_on: string | null; deadline_precision: string;
  deadline_time: string | null; deadline_timezone: string | null;
};
export type ActivityDetails = { tracks: { id: string; label: string }[]; windows: ActivityWindow[] };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string | null => typeof v === "string" && v.length <= 8000 ? v : null;
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01" || value > "2200-12-31") return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
const date = (v: unknown) => typeof v === "string" && validDate(v) ? v : null;
export function activityDetails(value: unknown): ActivityDetails {
  const d = object(value) ? value : {};
  if ((Array.isArray(d.tracks) && d.tracks.length > 20) || (Array.isArray(d.windows) && d.windows.length > 500)) return { tracks: [], windows: [] };
  return {
    tracks: Array.isArray(d.tracks) ? d.tracks.flatMap(t => object(t) && text(t.id) && text(t.label) ? [{ id: String(t.id), label: String(t.label) }] : []) : [],
    windows: Array.isArray(d.windows) ? d.windows.flatMap(w => {
      if (!object(w) || !text(w.id) || (w.track_id != null && !text(w.track_id)) || (w.route_id != null && !text(w.route_id))) return [];
      return [{ id: String(w.id), track_id: text(w.track_id), route_id: text(w.route_id),
        window_type: text(w.window_type) || "unknown", audience: text(w.audience), provider_text: text(w.provider_text) || "",
        opens_on: date(w.opens_on), opens_precision: text(w.opens_precision) || "unknown",
        deadline_on: date(w.deadline_on), deadline_precision: text(w.deadline_precision) || "unknown",
        deadline_time: text(w.deadline_time), deadline_timezone: text(w.deadline_timezone) }];
    }) : [],
  };
}
export function dateProblem(start: string, end: string): string | null {
  if ((start && !validDate(start)) || (end && !validDate(end))) return "Enter valid official activity dates.";
  if (start && end && start > end) return "The activity end date must be on or after its start date.";
  return null;
}
// Explicit scope only: never interpret audience prose or select a same-scope
// window by ID. Planning answers cannot establish provider eligibility.
export function planningWindows(details: ActivityDetails, track: string, routes: { id: string; track_id: string | null }[]): ActivityWindow[] {
  if (track && !details.tracks.some(t => t.id === track)) return [];
  return details.windows.filter(w => {
    if (w.window_type !== "application" || (w.track_id && w.track_id !== track)) return false;
    if (!w.route_id) return true;
    const route = routes.find(r => r.id === w.route_id);
    return !!route && (!route.track_id || route.track_id === track);
  });
}
export function deadlineText(w: ActivityWindow): string {
  if (w.deadline_precision === "provider_defined") return "Deadline depends on your country or group; check the official page.";
  if (!w.deadline_on) return "Deadline needs confirmation with the provider.";
  const day = longDate(w.deadline_on) || w.deadline_on;
  if (w.deadline_precision === "estimated") return `Estimated deadline: ${day}. Confirm with the provider.`;
  if (w.deadline_precision === "date_only") return `Deadline: ${day}. Closing time is not confirmed.`;
  if (w.deadline_precision === "exact_time" && w.deadline_time && w.deadline_timezone) return `Deadline: ${day}, ${w.deadline_time} (${w.deadline_timezone}).`;
  if (w.deadline_precision === "exact_local_time" && w.deadline_time) return `Deadline: ${day}, ${w.deadline_time}. Time zone needs confirmation.`;
  return "Deadline needs confirmation with the provider.";
}
export function openingText(w: ActivityWindow): string {
  if (w.opens_on && w.opens_precision === "date_only") return `Opens ${longDate(w.opens_on) || w.opens_on}.`;
  if (w.opens_on && w.opens_precision === "estimated") return `Expected to open around ${longDate(w.opens_on) || w.opens_on}; confirm with the provider.`;
  if (w.opens_precision === "not_announced") return "The last round has closed; the next opening date is not announced yet.";
  return "An exact opening date is not confirmed.";
}
