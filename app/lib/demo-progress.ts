// Fictional call IDs only. This never stores answers, identity, or real applications.
export const sampleStates = ["planned", "preparing", "submitted", "interview", "decision", "completed"] as const;
export type SampleState = typeof sampleStates[number];
export const sampleOutcomes = ["accepted", "rejected", "waitlisted", "withdrawn"] as const;
export type SampleOutcome = typeof sampleOutcomes[number];
export type SavedSample = { id: string; state: SampleState; outcome?: SampleOutcome };
export const demoProgressChanged = "scholarable:plan-changed";
const key = "scholarable-demo-progress-v1";
const sampleId = (id: unknown): id is string => typeof id === "string" && /^demo-[a-z]+(?:-[a-z]+)*$/.test(id);

export function readDemoProgress(storage: Pick<Storage, "getItem">): SavedSample[] {
  try {
    const raw = storage.getItem(key) || "[]";
    if (raw.length > 10000) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedSample => item && typeof item === "object"
      && sampleId(item.id) && sampleStates.includes(item.state)
      && (item.outcome === undefined || sampleOutcomes.includes(item.outcome))).slice(0, 20);
  } catch { return []; }
}

export function saveDemoProgress(storage: Pick<Storage, "getItem" | "setItem">, id: string, state: SampleState = "planned"): SavedSample[] {
  if (!sampleId(id) || !sampleStates.includes(state)) throw new Error("Unknown sample");
  const saved = readDemoProgress(storage);
  const previous = saved.find((item) => item.id === id);
  const current = saved.filter((item) => item.id !== id);
  const updated = [...current, { id, state, ...(previous?.outcome ? { outcome: previous.outcome } : {}) }].slice(-20);
  storage.setItem(key, JSON.stringify(updated));
  return updated;
}

export function setDemoOutcome(storage: Pick<Storage, "getItem" | "setItem">, id: string, outcome: SampleOutcome | null): SavedSample[] {
  if (!sampleId(id) || (outcome !== null && !sampleOutcomes.includes(outcome))) throw new Error("Unknown sample result");
  const current = readDemoProgress(storage);
  if (!current.some((item) => item.id === id)) throw new Error("Save the sample first");
  const updated = current.map((item) => item.id === id
    ? { id, state: item.state, ...(outcome ? { outcome } : {}) } : item);
  storage.setItem(key, JSON.stringify(updated));
  return updated;
}

export function removeDemoProgress(storage: Pick<Storage, "getItem" | "setItem">, id: string): SavedSample[] {
  const updated = readDemoProgress(storage).filter((item) => item.id !== id);
  storage.setItem(key, JSON.stringify(updated));
  return updated;
}
