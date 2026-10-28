export const profileItemKinds = [
  "education", "experience", "project", "volunteering", "award",
  "skill", "language", "motivation", "achievement", "story",
] as const;
export type ProfileItemKind = typeof profileItemKinds[number];
export type ProfileItemSource = "student_manual" | "cv_import" | "linkedin_import";
export type ProfileItemContent = {
  kind: ProfileItemKind;
  title: string;
  organisation?: string;
  role?: string;
  summary?: string;
  outcome?: string;
  start_date?: string;
  end_date?: string;
  tags?: string[];
  situation?: string;
  actions?: string;
  result?: string;
  reflection?: string;
};
export type ProfileItem = ProfileItemContent & {
  id: number;
  version: number;
  confirmation_state: "candidate" | "confirmed" | "rejected";
  sensitivity: "standard" | "moderate";
  purpose: "profile_reuse";
  retention_policy: "profile_active_v1";
  provenance: { kind: string; source_ref: string | null; actor: string; observed_at: string; transformation: string | null }[];
  source_excerpt: string | null;
  recorded_at: string;
  has_conflict: boolean;
  has_duplicate: boolean;
  history: (ProfileItemContent & {
    version: number;
    confirmation_state: "candidate" | "confirmed" | "rejected";
    sensitivity: "standard" | "moderate";
    provenance: ProfileItem["provenance"];
    source_excerpt: string | null;
    recorded_at: string;
  })[];
};
export type StudentProfileVault = { items: ProfileItem[] };

const optionalProfileKeys = ["organisation", "role", "summary", "outcome", "situation", "actions", "result", "reflection"] as const;

export function cleanProfileItemContent(input: Record<string, unknown>): ProfileItemContent {
  if (!profileItemKinds.includes(input.kind as ProfileItemKind)) throw new Error("Invalid profile item");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 200) throw new Error("Invalid profile item");
  const clean: ProfileItemContent = { kind: input.kind as ProfileItemKind, title };
  for (const key of optionalProfileKeys) {
    if (input[key] === undefined || input[key] === null || input[key] === "") continue;
    if (typeof input[key] !== "string") throw new Error("Invalid profile item");
    const value = input[key].trim();
    if (!value || value.length > 2000) throw new Error("Invalid profile item");
    clean[key] = value;
  }
  for (const key of ["start_date", "end_date"] as const) {
    if (input[key] === undefined || input[key] === null || input[key] === "") continue;
    if (typeof input[key] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input[key])
      || Number.isNaN(Date.parse(`${input[key]}T00:00:00Z`))) throw new Error("Invalid profile item");
    clean[key] = input[key];
  }
  if (clean.start_date && clean.end_date && clean.end_date < clean.start_date) throw new Error("Invalid profile item");
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags) || input.tags.length > 20) throw new Error("Invalid profile item");
    clean.tags = input.tags.map((tag) => {
      if (typeof tag !== "string" || !tag.trim() || tag.trim().length > 60) throw new Error("Invalid profile item");
      return tag.trim();
    });
  }
  return clean;
}
