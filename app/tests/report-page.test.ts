import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import test from "node:test";
import Report from "../routes/report";

function render(path: string) {
  const router = createMemoryRouter([{ id: "report", path: "/report", Component: Report, action: async () => ({}) }], { initialEntries: [path] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

test("report page retains sample context without treating it as a verified record", () => {
  const html = render("/report?call=demo-bachelor&version=2026-09-13T00%3A00%3A00Z");
  assert.match(html, /demo-bachelor/);
  assert.match(html, /Erfundenes Beispiel, kein geprüftes Stipendium/);
  assert.doesNotMatch(html, /2026-09-13|Last verified:/);
  assert.match(html, /Es wurde noch nichts gesendet oder empfangen/);
  // Fictional samples are never stored: no report form, only the email draft.
  assert.doesNotMatch(html, /<form/);
});

test("report page ignores unrelated query text instead of echoing it into markup or email", () => {
  const html = render("/report?call=demo-private-health-note&version=private-profile-value&profile=secret-income");
  assert.doesNotMatch(html, /private-health-note|private-profile-value|secret-income/);
  assert.match(html, /Schick uns den Link zum Stipendium mit/);
  assert.doesNotMatch(html, /<form/);
});

test("a published scholarship gets an anonymous one-click report form with the email path as fallback only", () => {
  const html = render("/report?call=42&version=2026-09-13T00%3A00%3A00Z");
  assert.match(html, /<form[^>]*method="post"/);
  assert.match(html, /name="call" value="42"/);
  assert.match(html, /name="version" value="2026-09-13T00:00:00Z"/);
  assert.match(html, /name="reason"/);
  assert.match(html, /name="note" maxLength="500"|maxlength="500"/i);
  assert.match(html, /Kein Konto und keine E-Mail nötig/);
  assert.match(html, /Wir löschen die Meldung 12 Monate nach ihrer Prüfung/);
  assert.doesNotMatch(html, /Prepare email report/);
  assert.doesNotMatch(html, /name="email"|type="email"/);
});

test("the form posts back only the validated reference, never unrelated query text", () => {
  const html = render("/report?call=42&version=2026-09-13T00%3A00%3A00Z&profile=secret-income&utm=track-me");
  assert.match(html, /<form[^>]*action="\/report\?call=42&amp;version=2026-09-13T00%3A00%3A00Z"/);
  assert.doesNotMatch(html, /secret-income|track-me/);
});
