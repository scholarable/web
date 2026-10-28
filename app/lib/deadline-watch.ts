import { deadlineText, validDate } from "./activity-planning";
import { deadlineWords } from "./copy-de";
import type { PublicDetails } from "./public-details";

// timing and scope stay English for sorting and the older tests; pages and reminder emails show the German pair.
export type DeadlineWatch = { id: string; date: string; timing: string; scope: string; daysAway: number; timingDe?: string; scopeDe?: string };

export function todayInBerlin(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function deadlineWatch(details: PublicDetails, today: string): DeadlineWatch[] {
  if (!validDate(today) || details.windows.length > 500) return [];
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const dates = details.windows.flatMap(window => {
    if (window.window_type !== "application" || !window.deadline_on || !validDate(window.deadline_on)
      || !["date_only", "exact_time", "exact_local_time"].includes(window.deadline_precision)) return [];
    const daysAway = Math.round((Date.parse(`${window.deadline_on}T00:00:00Z`) - todayMs) / 86400000);
    if (daysAway < 0) return [];
    const timing = deadlineText(window);
    if (timing === "Deadline needs confirmation with the provider.") return [];
    const track = window.track_id ? details.tracks.find(item => item.id === window.track_id) : null;
    const route = window.route_id ? details.routes.find(item => item.id === window.route_id) : null;
    if ((window.track_id && !track) || (window.route_id && !route)) return [];
    const named = [track?.label, route?.label].filter(Boolean).join(" · ");
    const words = deadlineWords(window);
    return [{ id: window.id, date: window.deadline_on, timing, scope: named || "General application window", daysAway,
      timingDe: [words.text, words.quiet].filter(Boolean).join(" · "), scopeDe: named || "Allgemeine Bewerbungsfrist" }];
  });
  // ponytail: ten nearest dates cover a pilot watchlist; pagination only if real use exceeds it.
  return dates.sort((a, b) => a.date.localeCompare(b.date) || a.scope.localeCompare(b.scope)).slice(0, 10);
}
