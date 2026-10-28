export const bonnPreviewTitle = "Universität Bonn PROMOS 2027";
export const bonnProgrammeUrl = "https://www.uni-west.example/de/studium/studium-und-praktikum-im-ausland/studium-im-ausland/free-mover/finanzierung/promos";
export const bonnApplicationUrl = `${bonnProgrammeUrl}-bewerbung`;

// A test-account-only snapshot of provider facts, not a reviewed catalogue call.
export const bonnPreviewDeadlines = [
  { id: "first-half", label: "Projektbeginn Januar–Juni 2027", date: "10. Januar 2027" },
  { id: "second-half", label: "Projektbeginn Juli–Dezember 2027", date: "26. Mai 2027" },
] as const;

const storageKey = "scholarable-account-bonn-preview-saved-v1";
export function bonnPreviewSaved(storage: Pick<Storage, "getItem">): boolean {
  try { return storage.getItem(storageKey) === "yes"; }
  catch { return false; }
}
export function setBonnPreviewSaved(storage: Pick<Storage, "setItem" | "removeItem">, saved: boolean): void {
  if (saved) storage.setItem(storageKey, "yes");
  else storage.removeItem(storageKey);
}
