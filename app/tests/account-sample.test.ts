import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import test from "node:test";
import Account from "../routes/account";
import { sampleAccountAllowed, sampleGuide, sampleSaved, setSampleSaved } from "../lib/account-sample";
import { applicationGuide } from "../lib/application-guide";
import AccountBonnPreview from "../routes/account-bonn-preview";
import AccountPracticeScholarship, { writingReady } from "../routes/account-practice-scholarship";
import { bonnPreviewDeadlines, bonnPreviewSaved, setBonnPreviewSaved } from "../lib/account-bonn-preview";

const accountMarkup = (sampleEnabled: boolean, documentsEnabled = false) => {
  const router = createMemoryRouter([{ id: "account", path: "/account", Component: Account }], {
    initialEntries: ["/account"],
    hydrationData: { loaderData: { account: {
      user: { email: "student@example.test" },
      progress: { profile: null, opportunities: [], applications: [], outcomes: [], email_reminders_enabled: false, recommendation_emails_enabled: false },
      calls: [], candidate: null, remindersAvailable: false, sampleEnabled, documentsEnabled,
    } } },
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
};

test("practice scholarship stays off without an exact account allowlist", () => {
  assert.equal(sampleAccountAllowed("student@example.test", undefined), false);
  assert.equal(sampleAccountAllowed("student@example.test", "other@example.test"), false);
  assert.equal(sampleAccountAllowed("STUDENT@example.test", "student@example.test"), true);
  assert.doesNotMatch(accountMarkup(false), /Übungs-Stipendium — erfunden/);
  assert.doesNotMatch(accountMarkup(false), /Universität Bonn PROMOS 2027/);
  assert.match(accountMarkup(true), /Übungs-Stipendium — erfunden/);
  assert.match(accountMarkup(true), /Universität Bonn PROMOS 2027/);
  assert.match(accountMarkup(true), /Nur zum Testen/);
  assert.doesNotMatch(accountMarkup(false), /Meine Dokumente/);
  assert.match(accountMarkup(false, true), /Meine Dokumente/);
});

test("Bonn preview stays private, browser-local, and not open for submission", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  assert.equal(bonnPreviewSaved(storage), false);
  setBonnPreviewSaved(storage, true);
  assert.equal(bonnPreviewSaved(storage), true);
  assert.deepEqual([...values.values()], ["yes"]);
  setBonnPreviewSaved(storage, false);
  assert.equal(bonnPreviewSaved(storage), false);
  assert.deepEqual(bonnPreviewDeadlines.map(item => item.date), ["10. Januar 2027", "26. Mai 2027"]);
  const router = createMemoryRouter([{ path: "/account/bonn-preview", Component: AccountBonnPreview }], {
    initialEntries: ["/account/bonn-preview"],
  });
  const markup = renderToStaticMarkup(createElement(RouterProvider, { router }));
  assert.match(markup, /Private Testvorschau/);
  assert.match(markup, /nicht geprüft und nicht veröffentlicht/);
  assert.match(markup, /Noch nicht offen/);
  assert.doesNotMatch(markup, /<button[^>]*>Submit/);
});

test("practice save stores only a boolean marker and guide is explicitly fictional", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  assert.equal(sampleSaved(storage), false);
  setSampleSaved(storage, true);
  assert.equal(sampleSaved(storage), true);
  assert.deepEqual([...values.values()], ["yes"]);
  setSampleSaved(storage, false);
  assert.equal(sampleSaved(storage), false);
  assert.deepEqual(applicationGuide(sampleGuide), sampleGuide);
  assert.equal(sampleGuide.application_route_available, false);
});

test("AI practice stays private and gated while the fictional application remains unsaved", () => {
  const AI = { run: async () => { assert.fail("render must not call AI"); } };
  const enabled = { SCHOLARABLE_WRITING_TEST_ENABLED: "true", SCHOLARABLE_WRITING_BUDGET_CONFIRMED: "true",
    SCHOLARABLE_WRITING_GATEWAY_ID: "student-writing", AI };
  assert.equal(writingReady(enabled), true);
  assert.equal(writingReady({ ...enabled, SCHOLARABLE_WRITING_TEST_ENABLED: "false" }), false);
  assert.equal(writingReady({ ...enabled, SCHOLARABLE_WRITING_BUDGET_CONFIRMED: "false" }), false);
  assert.equal(writingReady({ ...enabled, SCHOLARABLE_WRITING_GATEWAY_ID: "other" }), false);
  const markup = (writingTestEnabled: boolean) => renderToStaticMarkup(createElement(RouterProvider, {
    router: createMemoryRouter([{ id: "practice", path: "/account/practice-scholarship", Component: AccountPracticeScholarship }], {
      initialEntries: ["/account/practice-scholarship"], hydrationData: { loaderData: { practice: { writingTestEnabled } } },
    }),
  }));
  assert.doesNotMatch(markup(false), /Privater Test der KI-Schreibhilfe/);
  assert.match(markup(true), /Privater Test der KI-Schreibhilfe/);
  assert.match(markup(true), /Erfundene Angabe verwenden/);
  assert.doesNotMatch(markup(true), /<button[^>]*>Submit/);
});
