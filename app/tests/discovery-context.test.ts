import assert from "node:assert/strict";
import test from "node:test";
import { confirmedDiscoveryContext, contextStorageKey, readDiscoveryContext, type DiscoveryContext } from "../lib/discovery-context";
import { saveDiscoveryContext } from "../lib/student-progress.server";
const context: DiscoveryContext = {
  id: "cb150c90-9f25-47eb-8a1e-5b20c13acf68", expiresAt: Date.now() + 60_000,
  profile: { facts: {
    adult_confirmation: { value: true, value_state: "known", confirmation_state: "confirmed" },
    institution: { value: null, value_state: "unknown", confirmation_state: "confirmed" },
    degree_level: { value: "master", value_state: "known", confirmation_state: "confirmed" },
    subject: { value: null, value_state: "prefer_not_to_say", confirmation_state: "confirmed" },
    semester_number: { value: null, value_state: "unknown", confirmation_state: "confirmed" },
  } },
  items: [{ content: { kind: "skill", title: "TypeScript", summary: "TypeScript" }, source: "cv_import", reference: "line 2", excerpt: "Typescript" }],
};
test("explicit same-tab save handoff expires and survives authentication navigation", () => {
  let stored: string | null = JSON.stringify(context);
  const storage = { getItem: (key: string) => { assert.equal(key, contextStorageKey); return stored; }, removeItem: () => { stored = null; } };
  assert.deepEqual(readDiscoveryContext(storage), context);
  assert.equal(readDiscoveryContext(storage, context.expiresAt), null);
  assert.equal(stored, null);
  stored = '{"items":[]}';
  assert.equal(readDiscoveryContext(storage), null);
});
test("account save validates age, confirmation and permitted sources before one atomic write", async () => {
  const writes: { sql: string; args: unknown[] }[] = [];
  const query = async (sql: string, args: unknown[]) => { writes.push({ sql, args }); return []; };
  await saveDiscoveryContext(query, "11".repeat(32), context);
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /save_student_discovery_context/);
  const items = JSON.parse(String(writes[0].args[2]));
  assert.equal(items[0].excerpt, "Typescript");
  assert.equal(items[0].reference, `${context.id}:line 2`);
  for (const invalid of [
    { ...context, items: [{ ...context.items[0], source: "linkedin_import" }] },
    { ...context, expiresAt: 0 },
    { ...context, profile: { facts: { ...context.profile.facts, adult_confirmation: { value: false, value_state: "known", confirmation_state: "confirmed" } } } },
    { ...context, profile: { facts: { ...context.profile.facts, degree_level: { value: "master", value_state: "known", confirmation_state: "candidate" } } } },
  ]) await assert.rejects(saveDiscoveryContext(query, "11".repeat(32), invalid));
  assert.equal(writes.length, 1);
});

test("the UI context builder keeps CV source excerpts, corrected facts, and manual matching answers", async () => {
  const built = confirmedDiscoveryContext(context.profile,
    [{ id: "cv-1", kind: "skill", value: "TypeScript", originalValue: "Typescript", source: "line 2" }],
    { degree_level: { value: "master", reference: "line 1", excerpt: "Master of Science" } });
  assert.equal(built.items.length, 1);
  assert.equal(built.sources?.degree_level.source, "cv_import");
  assert.equal(built.sources?.degree_level.reference, "line 1");
  assert.equal(built.items[0].excerpt, "Typescript");
  assert.equal(built.profile, context.profile);
  const corrected = confirmedDiscoveryContext({ facts: { ...context.profile.facts, degree_level: { value: "doctoral", value_state: "known", confirmation_state: "confirmed" } } }, [],
    { degree_level: { value: "master", reference: "line 1", excerpt: "Master of Science" } });
  assert.equal(corrected.sources?.degree_level.source, "student_manual");
  await saveDiscoveryContext(async () => [], "11".repeat(32), built);
});
