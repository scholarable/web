import type { CvCandidate } from "./cv-import.server";
import type { MatchRequest } from "./contracts";
import type { ProfileItemContent } from "./profile-vault";

export const contextStorageKey = "scholarable-save-context-v1";
export type DiscoveryContext = {
  id: string;
  expiresAt: number;
  sources?: Record<string, { source: "student_manual" | "cv_import"; reference?: string }>;
  profile: MatchRequest["profile"];
  items: { content: ProfileItemContent; source: "student_manual" | "cv_import"; reference?: string; excerpt?: string }[];
};

// Only an explicit Save action writes this short-lived, same-tab handoff.
export function readDiscoveryContext(storage: Pick<Storage, "getItem" | "removeItem">, now = Date.now()): DiscoveryContext | null {
  try {
    const raw = storage.getItem(contextStorageKey);
    if (!raw) return null;
    if (raw.length > 64000) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value.id !== "string" || !value.profile?.facts || !Array.isArray(value.items)
      || value.items.length > 60 || Object.values(value.profile.facts).some((fact: any) => !fact || fact.confirmation_state !== "confirmed")
      || value.items.some((item: any) => !item?.content || typeof item.content.title !== "string")) return null;
    if (!Number.isFinite(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + 24 * 60 * 60 * 1000) {
      storage.removeItem(contextStorageKey); return null;
    }
    return value;
  } catch { return null; }
}

export type CvFactSources = Record<string, { value: string; reference: string; excerpt: string }>;

export function confirmedDiscoveryContext(profile: MatchRequest["profile"], candidates: CvCandidate[], sources: CvFactSources): DiscoveryContext {
  return { id: crypto.randomUUID(), expiresAt: Date.now() + 24 * 60 * 60 * 1000, profile,
    sources: Object.fromEntries(Object.entries(profile.facts).map(([field]) => {
      const source = sources[field === "milestone" ? "future_plan" : field];
      return [field, source && String(profile.facts[field].value) === source.value
        ? { source: "cv_import", reference: source.reference } : { source: "student_manual" }];
    })),
    items: candidates.map(candidate => ({ content: { kind: candidate.kind, title: candidate.value.slice(0, 200), summary: candidate.value },
        source: "cv_import" as const, reference: candidate.source, excerpt: candidate.originalValue || candidate.value })),
  };
}
