export type CvSuggestions = { institution?: string; degree_level?: "bachelor" | "master" | "doctoral"; subject?: string };
export type CvSuggestionFields = Partial<Record<keyof CvSuggestions, string>>;

export function definedCvSuggestions(suggestions: CvSuggestions): CvSuggestions {
  return Object.fromEntries(Object.entries(suggestions).filter((entry): entry is [string, string] => entry[1] !== undefined)) as CvSuggestions;
}

export function discardCvSuggestions<T extends CvSuggestionFields>(current: T, before: CvSuggestionFields, imported: CvSuggestions): T {
  const restored = { ...current };
  for (const key of Object.keys(imported) as (keyof CvSuggestions)[]) {
    if (restored[key] !== imported[key]) continue;
    if (before[key] === undefined) delete restored[key];
    else Object.assign(restored, { [key]: before[key] });
  }
  return restored;
}
const normal = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const contains = (haystack: string, phrase: string) => phrase.length >= 3 && (` ${haystack} `).includes(` ${phrase} `);

// Explicit catalogue phrases only. Multiple candidates stay unresolved. A
// taxonomy subject counts by its code or its German name.
export function cvSuggestions(text: string, options: { institution: string[]; subject: string[]; subjectInfo?: Record<string, { label: string }> }): CvSuggestions {
  if (text.length > 20000) throw new Error("Text too long");
  const body = normal(text);
  const single = (choices: string[], label: (choice: string) => string = choice => choice) => {
    const matches = choices.filter(choice => contains(body, normal(choice)) || contains(body, normal(label(choice))));
    return matches.length === 1 ? matches[0] : undefined;
  };
  const levels = ([
    ["bachelor", ["bachelor", "bsc", "b sc"]],
    ["master", ["master", "msc", "m sc"]],
    ["doctoral", ["doctoral", "doctorate", "phd", "ph d"]],
  ] as const).filter(([, aliases]) => aliases.some(alias => contains(body, alias)));
  return {
    institution: single(options.institution),
    subject: single(options.subject, choice => options.subjectInfo?.[choice]?.label || choice),
    degree_level: levels.length === 1 ? levels[0][0] : undefined,
  };
}
