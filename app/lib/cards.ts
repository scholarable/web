import { activityDetails } from "./activity-planning";
import { publicFunding, studyScope, type StudyScope } from "./public-details";
import { audienceShort, levelTagsDe, moneyFromSummary, moneyLine, timing, type MoneyLine, type Timing } from "./copy-de";

// What a scholarship card and the scholarship page's summary say, worked out
// on the server from the published facts for one day ("today" in Berlin).
export type CardFacts = {
  money: MoneyLine;
  timing: Timing;
  audience: string[];
  // The list card's "for whom": stated levels as tags; the scopes follow from
  // study and the named universities and subjects (scholarship-list.tsx).
  levelTags: string[];
  // Stated study levels and the identifiers of the rules that state them, so
  // a match result can say "your level is named" or "no level stated".
  levels: string[];
  levelRuleIds: string[];
  // Whether the call is for all, selected or unstated subjects and universities,
  // so the list can compare it with the chat's answers.
  study: { subjects: StudyScope; institutions: StudyScope };
};
export type CardInput = {
  funding: unknown;
  tracks: unknown;
  windows: unknown;
  applicationStatus: unknown;
  effectiveState: unknown;
  deadlineOn: unknown;
  summaryMoney: { min?: unknown; max?: unknown; currency?: unknown; frequency?: unknown; durationMonths?: unknown };
  levels: string[];
  levelRuleIds: string[];
  subjectScope: unknown;
  institutionScope: unknown;
};

export function cardFacts(input: CardInput, today: string): CardFacts {
  const { tracks, windows } = activityDetails({ tracks: input.tracks, windows: input.windows });
  const funding = publicFunding(input.funding);
  const subjects = studyScope(input.subjectScope), institutions = studyScope(input.institutionScope);
  return {
    money: moneyLine(funding, tracks) || moneyFromSummary(input.summaryMoney),
    timing: timing({ applicationStatus: input.applicationStatus, effectiveState: input.effectiveState, deadlineOn: input.deadlineOn, windows }, today),
    audience: audienceShort(input.levels, subjects, institutions),
    levelTags: levelTagsDe(input.levels),
    levels: input.levels,
    levelRuleIds: input.levelRuleIds,
    study: { subjects, institutions },
  };
}
