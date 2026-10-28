import { profileItemKinds, type ProfileItem, type ProfileItemKind } from "./profile-vault";
import type { StudentProgress } from "./student-progress.server";

export const profileKindDetails: Record<ProfileItemKind, { label: string; prompt: string; help: string }> = {
  education: { label: "Ausbildung", prompt: "Was hast du gelernt oder studiert?", help: "Deine Ausbildung zeigt deinen Weg und kann Bedingungen zu Studienniveau oder Fach belegen." },
  experience: { label: "Erfahrung", prompt: "Wo hast du mitgearbeitet oder gearbeitet?", help: "Rollen und Aufgaben zeigen den Gutachter:innen, was du kannst." },
  project: { label: "Projekte", prompt: "Was hast du gebaut, erforscht oder verbessert?", help: "Projekte zeigen Eigeninitiative und Fähigkeiten über Noten hinaus." },
  volunteering: { label: "Ehrenamt", prompt: "Wie hast du dich für andere eingesetzt?", help: "Ehrenamt kann langes Engagement und Verantwortung zeigen." },
  award: { label: "Auszeichnungen", prompt: "Welche Anerkennung hast du bekommen?", help: "Auszeichnungen belegen Leistungen kurz und klar, wenn eine Bewerbung danach fragt." },
  skill: { label: "Fähigkeiten", prompt: "Was kannst du sicher?", help: "Fähigkeiten helfen dir, passende Erfahrungen beim Bewerben schneller zu finden." },
  language: { label: "Sprachen", prompt: "Welche Sprachen sprichst du?", help: "Sprachen zählen nur, wenn ein Stipendium oder Programm Sprachkenntnisse verlangt." },
  motivation: { label: "Motivation", prompt: "Welche Richtung ist dir wichtig?", help: "Deine Motivation hilft dir, dich an die Gründe für deine Entscheidungen zu erinnern; sie ist freiwillig und entscheidet nicht über die Berechtigung." },
  achievement: { label: "Erfolge", prompt: "Auf welches Ergebnis bist du stolz?", help: "Erfolge halten einen konkreten Beitrag, ein Ergebnis oder einen Meilenstein fest, den du später belegen willst." },
  story: { label: "Wiederverwendbare Geschichten", prompt: "Welche Erfahrung erzählt eine gute Geschichte?", help: "Eine Geschichte aus Situation, Handeln, Ergebnis und Rückblick spart Zeit, wenn du eine Bewerbung vorbereitest." },
};

export const profileKinds = profileItemKinds.map((kind) => ({ kind, ...profileKindDetails[kind] }));

export function profileSourceLabel(item: Pick<ProfileItem, "provenance">): string {
  const origin = ({
    student_manual: "Von dir eingetragen",
    cv_import: "Aus einem Lebenslauf übernommen",
    linkedin_import: "Aus LinkedIn übernommen",
    ai_derived_candidate: "Aus bestätigten Angaben vorgeschlagen",
    student_confirmed: "Von dir bestätigt",
  }[item.provenance[0]?.kind] || "Erfasste Quelle");
  if (item.provenance.some((entry) => entry.transformation === "correction")) return `${origin}; von dir bearbeitet`;
  return item.provenance.some((entry) => entry.kind === "student_confirmed") ? `${origin}; von dir geprüft` : origin;
}

const matchingFields = ["institution", "degree_level", "subject", "semester_number"] as const;

export function profileReadiness(progress: Pick<StudentProgress, "profile">, items: ProfileItem[]) {
  const profile = progress.profile;
  const matchingKnown = matchingFields.filter((field) => profile?.[field]?.value_state === "known").length;
  const matchingAnswered = matchingFields.filter((field) => profile?.[field]?.value_state === "known"
    || profile?.[field]?.value_state === "unknown" || profile?.[field]?.value_state === "prefer_not_to_say").length;
  const confirmed = items.filter((item) => item.confirmation_state === "confirmed");
  const evidence = confirmed.filter((item) => item.kind !== "story").length;
  const stories = confirmed.filter((item) => item.kind === "story").length;
  const candidates = items.filter((item) => item.confirmation_state === "candidate").length;
  return { matchingKnown, matchingAnswered, matchingTotal: matchingFields.length, evidence, stories, candidates };
}
