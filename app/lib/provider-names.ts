// German names for providers whose records carry an English name. The site is
// German; the stored record keeps the name it was verified with, so this only
// changes what a page shows. Each entry is the name the provider's own German
// page states (live list of 28 October 2026: every other listed provider
// already has its German or official name).
const GERMAN_NAMES: Record<string, string> = {
  // (link removed)
  // ("Deutscher Akademischer Austauschdienst ... Kennedyallee 50 53175 Bonn")
  "German Academic Exchange Service (DAAD)": "Deutscher Akademischer Austauschdienst (DAAD)",
  // (link removed)
  // ("Die Technische Universität München ist eine Körperschaft des Öffentlichen Rechts")
  "Technical University of Munich (TUM)": "Technische Universität München (TUM)",
  // (link removed)
  // ("Das Programm Hamburglobal unterstützt Studierende der Universität Hamburg")
  "University of Hamburg": "Universität Hamburg",
};

export function providerDisplayName(name: string): string {
  return GERMAN_NAMES[name.trim()] ?? name;
}

// A Deutschlandstipendium call whose stored title is English ("Deutschlandstipendium
// at the University of Cologne, next round (funding from winter semester
// 2027/28)") is shown as the programme, the year the title gives right after
// it, and the provider's German name. The dash needs no article or declension
// ("an der Technischen Universität Dortmund"); the round's dates stay on the
// card and the page, which show the verified windows.
export function callDisplayTitle(title: string, provider: string | null): string {
  if (!provider || !/\bDeutschlandstipendium\b/.test(title) || !/\bat\b/.test(title)) return title;
  const year = title.match(/\bDeutschlandstipendium (\d{4}(?:\/\d{2}(?:\d{2})?)?)\b/)?.[1];
  return `Deutschlandstipendium${year ? ` ${year}` : ""} – ${providerDisplayName(provider)}`;
}
