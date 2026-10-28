import type { Recommendation } from "./contracts";

export function roadmapSections(recommendations: Recommendation[]) {
  return [
    { id: "apply", title: "Apply now", description: "The checked rules match and the application window is open.", items: recommendations.filter((item) => item.actionable) },
    { id: "prepare", title: "Prepare next", description: "An officially recorded opening date is ahead. Confirm the details before planning around it.",
      items: recommendations.filter((item) => !item.actionable && item.status === "match" && item.routeAvailable && item.window_state === "announced" && item.openingOn) },
    { id: "check", title: "Check before planning", description: "Eligibility or application timing is not confirmed enough to recommend an action yet.",
      items: recommendations.filter((item) => item.status !== "mismatch" && !item.actionable && !(item.status === "match" && item.routeAvailable && item.window_state === "announced" && item.openingOn)) },
    { id: "not-match", title: "Does not match these answers", description: "At least one required rule conflicts with an answer. Correct an answer if it is wrong, then check again.",
      items: recommendations.filter((item) => item.status === "mismatch") },
  ].filter((section) => section.items.length > 0);
}
