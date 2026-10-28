import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import test from "node:test";
import { profileKinds, profileReadiness } from "../lib/profile-experience";
import type { ProfileItem } from "../lib/profile-vault";
import Profile from "../routes/profile";

const baseItem: ProfileItem = {
  id: 7, version: 2, kind: "project", title: "Campus accessibility map", organisation: "Student union",
  role: "Research lead", summary: "Mapped routes.", outcome: "Published a guide.", tags: ["research"],
  confirmation_state: "candidate", sensitivity: "standard", purpose: "profile_reuse", retention_policy: "profile_active_v1",
  provenance: [{ kind: "cv_import", source_ref: "cv-session-7", actor: "import_service", observed_at: "2026-09-23T00:00:00Z", transformation: null }],
  source_excerpt: "Campus accessibility map", recorded_at: "2026-09-23T00:00:00Z", has_conflict: true, has_duplicate: false,
  history: [
    { version: 2, kind: "project", title: "Campus accessibility map", role: "Research lead", tags: ["research"], confirmation_state: "candidate", sensitivity: "standard", provenance: [{ kind: "cv_import", source_ref: "cv-session-7", actor: "import_service", observed_at: "2026-09-22T00:00:00Z", transformation: null }, { kind: "student_manual", source_ref: null, actor: "student", observed_at: "2026-09-23T00:00:00Z", transformation: "correction" }], source_excerpt: "Campus accessibility map", recorded_at: "2026-09-23T00:00:00Z" },
    { version: 1, kind: "project", title: "Campus routes", confirmation_state: "candidate", sensitivity: "standard", provenance: [{ kind: "cv_import", source_ref: "cv-session-7", actor: "import_service", observed_at: "2026-09-22T00:00:00Z", transformation: null }], source_excerpt: "Campus routes", recorded_at: "2026-09-22T00:00:00Z" },
  ],
};

const matchingProfile = {
  adult_confirmation: { value: true, value_state: "known", confirmation_state: "confirmed" },
  institution: { value: "Example University", value_state: "known", confirmation_state: "confirmed" },
  degree_level: { value: "bachelor", value_state: "known", confirmation_state: "confirmed" },
  subject: { value: null, value_state: "prefer_not_to_say", confirmation_state: "confirmed" },
  semester_number: { value: null, value_state: "unknown", confirmation_state: "confirmed" },
  milestone: { value: null, value_state: "unknown", confirmation_state: "confirmed" },
} as const;

function render(items: ProfileItem[] = []) {
  const router = createMemoryRouter([{ id: "profile", path: "/profile", Component: Profile, action: async () => ({}) }], {
    initialEntries: ["/profile"],
    hydrationData: { loaderData: { profile: {
      progress: { profile: matchingProfile, opportunities: [], applications: [], outcomes: [], email_reminders_enabled: false, recommendation_emails_enabled: false },
      vault: { items },
    } } },
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

test("guided profile covers every canonical category and preserves explicit unknown states", () => {
  const html = render();
  assert.equal(profileKinds.length, 10);
  for (const entry of profileKinds) {
    assert.match(html, new RegExp(`id="${entry.kind}"`));
    assert.match(html, new RegExp(entry.label));
  }
  assert.match(html, /Weiß ich nicht/);
  assert.match(html, /Möchte ich nicht sagen/);
  assert.match(html, /name="institution_state"/);
  assert.match(html, /name="subject_state"/);
  assert.match(html, /beides ist kein Fehler/);
  assert.match(html, /Jetzt überspringen/);
  assert.match(html, /Dein Profil ist noch leer/);
  assert.match(html, /Meine Daten herunterladen/);
  assert.match(html, /Alle gespeicherten Daten löschen/);
});

test("candidate review, conflicts, provenance and version history stay understandable", () => {
  const html = render([baseItem]);
  assert.match(html, /Zu prüfen/);
  assert.match(html, /zählt für Abgleich und Bewerbungen erst, wenn du ihn bestätigst/);
  assert.match(html, /Möglicher Widerspruch/);
  assert.match(html, /hat sie nicht zusammengeführt/);
  assert.match(html, /Aus einem Lebenslauf übernommen/);
  assert.match(html, /Woher das kommt/);
  assert.match(html, /Eintrag bestätigen/);
  assert.match(html, /Vorschlag ablehnen/);
  assert.match(html, /Version 2/);
  assert.match(html, /Research lead/);
  assert.match(html, /von dir bearbeitet/);
  assert.match(html, /Für diese Version gespeicherte Quelle/);
  assert.match(html, /Neue Version speichern und bestätigen/);
  assert.match(html, /Eintrag löschen/);
});

test("readiness separates starter matching facts from optional evidence and stories", () => {
  const evidence = { ...baseItem, id: 8, confirmation_state: "confirmed" as const };
  const story = { ...evidence, id: 9, kind: "story" as const, title: "A difficult deadline" };
  assert.deepEqual(profileReadiness({ profile: matchingProfile }, [baseItem, evidence, story]), {
    matchingKnown: 2, matchingAnswered: 4, matchingTotal: 4, evidence: 1, stories: 1, candidates: 1,
  });
  const html = render([baseItem, evidence, story]);
  assert.match(html, /2\/4/);
  assert.match(html, /Grundangaben für den Abgleich bekannt/);
  assert.match(html, /Bestätigte Nachweise/);
  assert.match(html, /Wiederverwendbare Geschichten/);
  assert.match(html, /Vorschläge zu prüfen/);
  assert.match(html, /„Wiederverwendbare Geschichten“ hinzufügen/);
});

test("profile layout keeps keyboard focus visible and collapses for mobile", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /summary:focus-visible/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.profile-workspace \{ grid-template-columns: 1fr/);
  assert.match(css, /\.profile-index \{ grid-template-columns: repeat\(2/);
});
