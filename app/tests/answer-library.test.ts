import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { answerLibrary, reuseWarnings, suggestedAnswers, suggestedStories } from "../lib/answer-library";
import AnswerLibraryPage from "../routes/answer-library";
import { readStudentAnswerLibrary, saveStudentAnswerToLibrary, updateStudentLibraryAnswer, type StudentDataQuery } from "../lib/student-progress.server";

const raw = [{ id: "1", call_id: "42", programme_title: "Example scholarship", packet_version: "packet-1", question_id: "old-question",
  question: { prompt: "Describe your community leadership", word_limit: 200 }, draft_version: 1,
  archived_at: null, created_at: "2026-09-28T00:00:00Z", submitted: false, reflection: {}, reflection_version: 0,
  history: [{ version: 1, answer: "I led a community project.", themes: ["leadership"],
    profile_links: [{ item_id: 7, version: 2, content: { kind: "project", title: "Community project" } }],
    approved_at: "2026-09-28T00:00:00Z" }] }];

test("suggestions explain shared question terms without inserting an answer", () => {
  const items = answerLibrary(raw)!;
  assert.equal(suggestedAnswers(items, "How did you show community leadership?", "43", "new-question")[0].item.id, "1");
  assert.match(suggestedAnswers(items, "How did you show community leadership?", "43", "new-question")[0].reason, /community/);
  assert.deepEqual(suggestedAnswers(items, "Explain your finances", "43", "new-question"), []);
  assert.deepEqual(suggestedAnswers(items, "Community leadership", "42", "old-question"), []);
  assert.equal(suggestedStories([{ id: 7, kind: "story", title: "Community leadership", confirmation_state: "confirmed", tags: [], has_conflict: false } as never],
    "How did you show community leadership?")[0].item.id, 7);
  assert.equal(answerLibrary([{ ...raw[0], history: [{ ...raw[0].history[0], themes: ["invented"] }] }]), null);
});

test("reuse flags missing, changed, and conflicting confirmed facts", () => {
  const item = answerLibrary(raw)![0];
  assert.match(reuseWarnings(item, [] )[0], /nicht mehr bestätigt/);
  const profile = { id: 7, version: 3, confirmation_state: "confirmed", has_conflict: false };
  assert.match(reuseWarnings(item, [profile as never])[0], /geändert oder widerspricht/);
  assert.deepEqual(reuseWarnings(item, [{ ...profile, version: 2 } as never]), []);
});

test("library writes remain parameterized and validate IDs before storage", async () => {
  const calls: { text: string; values: unknown[] }[] = [];
  const query: StudentDataQuery = async (text, values) => {
    calls.push({ text, values });
    return text.includes("read_student_answer_library") ? [{ library: raw }] : [{ item_id: "1", version: 2 }];
  };
  const digest = "11".repeat(32);
  assert.deepEqual(await readStudentAnswerLibrary(query, digest), answerLibrary(raw));
  assert.equal(await saveStudentAnswerToLibrary(query, digest, "42", "old-question", ["leadership"], ["7"]), "1");
  assert.equal(await updateStudentLibraryAnswer(query, digest, "1", "Revised", ["impact"], ["7"], 1), 2);
  assert.ok(calls.every(call => call.text.includes("$1") && !call.text.includes(digest)));
  const never: StudentDataQuery = async () => { assert.fail("invalid input reached storage"); };
  await assert.rejects(saveStudentAnswerToLibrary(never, digest, "0", "question", [], []));
  await assert.rejects(updateStudentLibraryAnswer(never, digest, "1", "", [], [], 1));
});

test("library page exposes explicit approval, export, and deletion controls", () => {
  const router = createMemoryRouter([{ id: "library", path: "/account/library", Component: AnswerLibraryPage, action: async () => ({}) }], {
    initialEntries: ["/account/library"],
    hydrationData: { loaderData: { library: { library: raw, vault: { items: [] } } } },
  });
  const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
  assert.match(html, /Neue Version freigeben/);
  assert.match(html, /Antwort kopieren/);
  assert.match(html, /Diese Antwort herunterladen/);
  assert.match(html, /Alle Antworten löschen/);
});
