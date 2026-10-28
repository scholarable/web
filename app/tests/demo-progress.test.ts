import assert from "node:assert/strict";
import test from "node:test";
import { readDemoProgress, removeDemoProgress, saveDemoProgress, setDemoOutcome } from "../lib/demo-progress";
import { loader as myPlanLoader } from "../routes/my-plan";

function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}

test("sample progress stores fictional IDs and stages only", () => {
  const storage = memory();
  saveDemoProgress(storage, "demo-bachelor");
  saveDemoProgress(storage, "demo-exchange", "preparing");
  assert.deepEqual(readDemoProgress(storage), [{ id: "demo-bachelor", state: "planned" }, { id: "demo-exchange", state: "preparing" }]);
  saveDemoProgress(storage, "demo-bachelor", "submitted");
  assert.deepEqual(readDemoProgress(storage), [{ id: "demo-exchange", state: "preparing" }, { id: "demo-bachelor", state: "submitted" }]);
  removeDemoProgress(storage, "demo-exchange");
  assert.deepEqual(readDemoProgress(storage), [{ id: "demo-bachelor", state: "submitted" }]);
  assert.equal([...storage.values.values()][0].includes("profile"), false);
});

test("sample progress rejects real IDs, invalid stages and corrupted browser storage", () => {
  const storage = memory();
  assert.throws(() => saveDemoProgress(storage, "123"));
  assert.throws(() => saveDemoProgress(storage, "demo-bachelor", "approved" as never));
  storage.setItem("scholarable-demo-progress-v1", "not json");
  assert.deepEqual(readDemoProgress(storage), []);
  storage.setItem("scholarable-demo-progress-v1", JSON.stringify([{ id: "123", state: "submitted" }, { id: "demo-bachelor", state: "invalid" }]));
  assert.deepEqual(readDemoProgress(storage), []);
});

test("sample outcomes remain private browser labels and survive stage changes", () => {
  const storage = memory();
  saveDemoProgress(storage, "demo-bachelor");
  assert.deepEqual(setDemoOutcome(storage, "demo-bachelor", "waitlisted"), [{ id: "demo-bachelor", state: "planned", outcome: "waitlisted" }]);
  assert.deepEqual(saveDemoProgress(storage, "demo-bachelor", "interview"), [{ id: "demo-bachelor", state: "interview", outcome: "waitlisted" }]);
  assert.deepEqual(setDemoOutcome(storage, "demo-bachelor", null), [{ id: "demo-bachelor", state: "interview" }]);
  assert.throws(() => setDemoOutcome(storage, "123", "accepted"));
  assert.throws(() => setDemoOutcome(storage, "demo-master", "accepted"));
  storage.setItem("scholarable-demo-progress-v1", JSON.stringify([{ id: "demo-bachelor", state: "planned", outcome: "invented" }]));
  assert.deepEqual(readDemoProgress(storage), []);
});

test("sample workspace is unavailable outside demo builds", async () => {
  await assert.rejects(myPlanLoader({} as never), (error) => error instanceof Response && error.status === 404);
});
