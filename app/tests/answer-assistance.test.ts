import assert from "node:assert/strict";
import test from "node:test";
import { assistWriting, selectedWritingSources, type WritingAI, type WritingInput } from "../lib/answer-assistance.server";
import type { AnswerLibraryItem } from "../lib/answer-library";
import type { GuideQuestion } from "../lib/application-guide";
import type { ProfileItem } from "../lib/profile-vault";

const question = { id: "q1", prompt: "What did you contribute?", response_kind: "long_text",
  word_limit: 100, character_limit: 500, help_text: null } as GuideQuestion;
const confirmed = { id: 7, version: 2, kind: "project", title: "Community project", summary: "I led the project.",
  confirmation_state: "confirmed", has_conflict: false } as ProfileItem;
const input: WritingInput = { action: "draft", question, answer: "", otherAnswers: [], selectedProfileIds: ["7"],
  selectedAnswerIds: [], profile: [confirmed, { ...confirmed, id: 8, title: "PRIVATE UNSELECTED FACT" }], library: [] };
const env = { SCHOLARABLE_WRITING_ENABLED: "true", SCHOLARABLE_WRITING_BUDGET_CONFIRMED: "true", SCHOLARABLE_WRITING_GATEWAY_ID: "student-writing" };

test("only selected confirmed material reaches a non-logging, non-cached gateway and output remains a suggestion", async () => {
  const calls: { input: object; options: object }[] = [];
  const AI: WritingAI = { run: async (_model, request, options) => {
    calls.push({ input: request, options });
    return { response: calls.length === 1
      ? { text: "I led the project.", claims: [{ text: "I led the project.", source_ids: ["profile:7:2"] }], gaps: [], warnings: [] }
      : { supported: true } };
  } };
  const result = await assistWriting(input, { ...env, AI });
  assert.equal(result.text, "I led the project.");
  assert.deepEqual(result.claims, [{ text: "I led the project.", source_ids: ["profile:7:2"] }]);
  assert.deepEqual(result.sources, [{ id: "profile:7:2", label: "Community project" }]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => JSON.stringify(call.options) === JSON.stringify({ gateway: { id: "student-writing", collectLog: false, skipCache: true } })));
  assert.ok(calls.every(call => !JSON.stringify(call.input).includes("PRIVATE UNSELECTED FACT")));
});

test("disabled budget, unconfirmed sources, uncited text, and unsupported claims fail closed", async () => {
  const never: WritingAI = { run: async () => { assert.fail("AI must not run"); } };
  await assert.rejects(assistWriting(input, { ...env, SCHOLARABLE_WRITING_BUDGET_CONFIRMED: "false", AI: never }), /not available/);
  assert.throws(() => selectedWritingSources({ ...input, profile: [{ ...confirmed, confirmation_state: "candidate" }] }), /no longer confirmed/);
  assert.throws(() => selectedWritingSources({ ...input, selectedProfileIds: ["999"] }), /no longer confirmed/);
  let count = 0;
  const AI: WritingAI = { run: async () => {
    count++;
    return { response: count === 1
      ? { text: "I led the project. Invented prize.", claims: [{ text: "I led the project.", source_ids: ["profile:7:2"] }], gaps: [], warnings: [] }
      : { supported: true } };
  } };
  await assert.rejects(assistWriting(input, { ...env, AI }), /complete source references/);
  assert.equal(count, 1);
  const rejected: WritingAI = { run: async (_model, _request, _options) => ({ response: ++count === 2
    ? { text: "I won a prize.", claims: [{ text: "I won a prize.", source_ids: ["profile:7:2"] }], gaps: [], warnings: [] }
    : { supported: false } }) };
  await assert.rejects(assistWriting(input, { ...env, AI: rejected }), /could not verify/);
});

test("critique keeps feedback but discards model-generated answer text", async () => {
  let calls = 0;
  const AI: WritingAI = { run: async () => {
    calls++;
    return { response: { text: "Invented claim.", claims: [{ text: "Invented claim.", source_ids: ["unknown"] }], gaps: [], warnings: ["Check the evidence."] } };
  } };
  const result = await assistWriting({ ...input, action: "critique", answer: "I led the project." }, { ...env, AI });
  assert.equal(calls, 1);
  assert.equal(result.text, "");
  assert.deepEqual(result.claims, []);
  assert.deepEqual(result.warnings, ["Check the evidence."]);
});

test("conflicting facts, stale answers, and IDs absent from this student's vault never reach AI", async () => {
  const never: WritingAI = { run: async () => { assert.fail("AI must not run"); } };
  await assert.rejects(assistWriting({ ...input, profile: [{ ...confirmed, has_conflict: true }] }, { ...env, AI: never }), /conflicts/);
  await assert.rejects(assistWriting({ ...input, selectedProfileIds: ["99"] }, { ...env, AI: never }), /no longer confirmed/);
  const stale = { id: "9", archived_at: null, question: { prompt: "What did you contribute?" },
    history: [{ version: 1, answer: "I led the project.", profile_links: [{ item_id: 7, version: 1 }] }] } as AnswerLibraryItem;
  await assert.rejects(assistWriting({ ...input, selectedAnswerIds: ["9"], library: [stale] }, { ...env, AI: never }), /needs review/);
});
