export type FactState = "known" | "unknown" | "prefer_not_to_say" | "not_applicable";
export type MatchStatus = "match" | "mismatch" | "needs_confirmation";

export type ConfirmedFact = {
  value: string | number | boolean | null;
  value_state: FactState;
  confirmation_state: "confirmed";
};

export type MatchRequest = {
  profile: { facts: Record<string, ConfirmedFact> };
};

export type Recommendation = import("./matching").MatchVariant & {
  title: string; slug: string; routeAvailable: boolean;
  openingOn: string | null; deadline: string | null;
  source: { label: string; url: string } | null;
};

export type MatchFollowUp = { field: string; label: string };
export type MatchResult = { recommendations: Recommendation[]; followUps?: MatchFollowUp[] };

export type ScholarshipSummary = {
  id: string;
  slug: string;
  title: string;
  provider: string | null;
  funding: string;
  deadline: string;
  audience: string;
  status: "open" | "planned" | "not_announced";
  lastChecked: string | null;
  // The scheduled re-check is overdue: still listed, with a note to check the provider page.
  reviewOverdue?: boolean;
};
