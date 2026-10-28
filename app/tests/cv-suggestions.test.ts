import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { correctCvCandidate, CvOnboarding, removeCvCandidate } from "../components/cv-onboarding";
import type { CvCandidate } from "../lib/cv-import.server";
import { cvSuggestions, definedCvSuggestions, discardCvSuggestions } from "../lib/cv-suggestions";

const options = { institution: ["Example University"], subject: ["computer_science", "engineering"] };

test("CV helper suggests exact catalogue phrases but never guesses ambiguous degrees", () => {
  assert.deepEqual(cvSuggestions("MSc in Computer Science, Example University", options), {
    institution: "Example University", subject: "computer_science", degree_level: "master",
  });
  assert.deepEqual(cvSuggestions("BSc Computer Science; MSc Engineering at Example University", options), {
    institution: "Example University", subject: undefined, degree_level: undefined,
  });
  assert.deepEqual(cvSuggestions("Master of physics at an unlisted school", options), {
    institution: undefined, subject: undefined, degree_level: "master",
  });
  assert.throws(() => cvSuggestions("x".repeat(20001), options));
});

test("CV import is optional, bounded and requires fact confirmation", () => {
  const html = renderToStaticMarkup(createElement(CvOnboarding, { options, onApply: () => {} }));
  assert.match(html, /PDF- oder DOCX-Datei mit bis zu 4 MB/);
  assert.match(html, /Originaldatei wird nur während dieser Anfrage verarbeitet und von Scholarable nicht gespeichert/);
  assert.match(html, /höchstens 4.000 umgewandelte Tokens an und nutzt begrenzte Durchgänge zum Herauslesen und Prüfen bei Cloudflare/);
  assert.match(html, /type="file"/);
  assert.match(html, /Angaben finden/);
  assert.doesNotMatch(html, /LinkedIn profile|action=/);
});

test("correcting or removing an imported fact also removes its confirmation", () => {
  const candidates: CvCandidate[] = [{ id: "cv-1", kind: "skill", value: "Typescript", source: "Skills" }];
  assert.deepEqual(correctCvCandidate(candidates, ["cv-1"], "cv-1", "TypeScript"), {
    candidates: [{ id: "cv-1", kind: "skill", value: "TypeScript", originalValue: "Typescript", source: "Skills" }], confirmed: [],
  });
  assert.deepEqual(removeCvCandidate(candidates, ["cv-1"], "cv-1"), { candidates: [], confirmed: [] });
});

test("discarding an import restores unchanged CV-derived fields but keeps later corrections", () => {
  const before = { institution: "Original University", subject: "engineering" };
  const imported = { institution: "Example University", degree_level: "master" as const };
  assert.deepEqual(discardCvSuggestions({ ...before, ...imported }, before, imported), before);
  assert.deepEqual(discardCvSuggestions({ ...before, ...imported, degree_level: "doctoral" }, before, imported), {
    ...before, degree_level: "doctoral",
  });
});

test("a CV without supported study phrases cannot erase goal-derived study facts", () => {
  const goalFacts = { institution: "Example University", degree_level: "bachelor" };
  const suggestions = definedCvSuggestions(cvSuggestions("TypeScript and French", options));
  assert.deepEqual(suggestions, {});
  assert.deepEqual({ ...goalFacts, ...suggestions }, goalFacts);
});
