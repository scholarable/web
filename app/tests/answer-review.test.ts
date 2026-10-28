import assert from "node:assert/strict";
import test from "node:test";
import { reviewAnswer } from "../lib/answer-review";

test("draft review flags verified limits and exact repeated text without claiming fact verification", () => {
  const answer = "I led a community project that brought students together to build a useful local resource for their neighbours.";
  const result = reviewAnswer(answer, { word_limit: 10, character_limit: 80 }, [`Earlier: ${answer}`]);
  assert.equal(result.words, 18);
  assert.equal(result.characters, answer.length);
  assert.equal(result.warnings.length, 3);
  assert.match(result.warnings[0], /8 Wörter über der geprüften Grenze von 10 Wörtern/);
  assert.match(result.warnings[1], /Zeichen über der geprüften Grenze von 80 Zeichen/);
  assert.match(result.warnings[2], /wiederholt Text/);
  assert.deepEqual(reviewAnswer("", { word_limit: null, character_limit: null }, []).warnings, ["Diese Frage hat noch keine Antwort."]);
  assert.equal(reviewAnswer("Hi 👋", { word_limit: null, character_limit: 4 }, []).characters, 4);
});
