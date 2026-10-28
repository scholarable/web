import assert from "node:assert/strict";
import test from "node:test";
import {
  createStudentProfileItem,
  createStudentProfileSnapshot,
  deleteStudentAccount,
  deleteStudentApplication,
  deleteStudentProfileItem,
  readStudentMatchingFacts,
  readStudentProfileSnapshot,
  readStudentProfileSnapshots,
  readStudentProfileVault,
  readStudentProgress,
  saveStudentProfile,
  setStudentApplicationState,
  setStudentApplicationOutcome,
  setStudentOpportunity,
  setStudentReminderConsent,
  setStudentProfileItemConfirmation,
  studentDataQuery,
  studentSubjectDigest,
  updateStudentProfileItem,
  type StudentDataQuery,
} from "../lib/student-progress.server";
import { cleanProfileItemContent } from "../lib/profile-vault";

const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const digest = "ab".repeat(32);
const profile = { facts: {
  adult_confirmation: { value: true, value_state: "known" as const, confirmation_state: "confirmed" as const },
  institution: { value: "Example University", value_state: "known" as const, confirmation_state: "confirmed" as const },
  degree_level: { value: "bachelor", value_state: "known" as const, confirmation_state: "confirmed" as const },
  subject: { value: "computer_science", value_state: "known" as const, confirmation_state: "confirmed" as const },
  semester_number: { value: 2, value_state: "known" as const, confirmation_state: "confirmed" as const },
  milestone: { value: null, value_state: "prefer_not_to_say" as const, confirmation_state: "confirmed" as const },
} };

test("student identity handles are stable HMACs and never raw provider identifiers", async () => {
  const first = await studentSubjectDigest({ issuer: "https://identity.example", subject: "student-123" }, key);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, await studentSubjectDigest({ issuer: "https://identity.example", subject: "student-123" }, key));
  assert.notEqual(first, await studentSubjectDigest({ issuer: "https://identity.example", subject: "student-456" }, key));
  await assert.rejects(studentSubjectDigest({ issuer: "http://identity.example", subject: "student" }, key));
  await assert.rejects(studentSubjectDigest({ issuer: "https://identity.example", subject: "student" }, "short"));
});

test("student storage requires its dedicated session and current Neon role", async () => {
  await assert.rejects(studentDataQuery(undefined), /connection unavailable/);
  await assert.rejects(studentDataQuery({ SCHOLARABLE_STUDENT_DATABASE_URL: "not-a-valid-url" }));
  const connection = (role: string, sessionRole: string) => () => ({ query: async () => [{ role, session_role: sessionRole }] });
  await assert.rejects(studentDataQuery({ SCHOLARABLE_STUDENT_DATABASE_URL: "postgres://test" }, connection("scholarable_student_app", "owner")), /Dedicated student data role/);
  await assert.rejects(studentDataQuery({ SCHOLARABLE_STUDENT_DATABASE_URL: "postgres://test" }, connection("owner", "owner")), /Dedicated student data role/);
  assert.equal(typeof await studentDataQuery({ SCHOLARABLE_STUDENT_DATABASE_URL: "postgres://test" }, connection("scholarable_student_app", "scholarable_student_app")), "function");
});

test("profile and progress writes stay parameterized behind the private functions", async () => {
  const calls: { text: string; values: unknown[] }[] = [];
  const query: StudentDataQuery = async (text, values) => { calls.push({ text, values }); return [{ deleted: true }]; };
  await saveStudentProfile(query, digest, profile);
  await setStudentOpportunity(query, digest, "42", "saved");
  await setStudentApplicationState(query, digest, "42", "preparing");
  await setStudentApplicationOutcome(query, digest, "42", "accepted");
  await setStudentReminderConsent(query, digest, true, "privacy-2026-09-17");
  assert.equal(await deleteStudentApplication(query, digest, "42"), true);
  assert.equal(await deleteStudentAccount(query, digest), true);
  assert.equal(calls.length, 7);
  assert.ok(calls.every((call) => call.text.includes("$1") && !call.text.includes(digest)));
  assert.equal(calls[0].values[0], digest);
  assert.doesNotMatch(String(calls[0].values[1]), /student-123|identity\.example/);
});

test("student progress reads use only the pseudonymous handle", async () => {
  const calls: { text: string; values: unknown[] }[] = [];
  const expected = { profile: null, opportunities: [], applications: [], outcomes: [], email_reminders_enabled: false, recommendation_emails_enabled: false };
  const query: StudentDataQuery = async (text, values) => { calls.push({ text, values }); return [{ progress: expected }]; };
  assert.deepEqual(await readStudentProgress(query, digest), expected);
  assert.deepEqual(calls, [{ text: "select read_student_progress(decode($1, 'hex')) as progress", values: [digest] }]);
});

test("invalid profile and call identifiers are rejected before storage", async () => {
  const never: StudentDataQuery = async () => { assert.fail("storage must not run"); };
  const invalid = structuredClone(profile);
  invalid.facts.adult_confirmation.value = false;
  await assert.rejects(saveStudentProfile(never, digest, invalid));
  await assert.rejects(setStudentOpportunity(never, digest, "42 OR 1=1", "saved"));
  await assert.rejects(setStudentApplicationState(never, digest, "0", "planned"));
  await assert.rejects(setStudentApplicationOutcome(never, digest, "0", "accepted"));
  await assert.rejects(setStudentApplicationOutcome(never, digest, "42", "awarded" as never));
  await assert.rejects(setStudentReminderConsent(never, digest, true, " "));
});

test("vault writes are validated, parameterized and candidate imports cannot self-confirm", async () => {
  const calls: { text: string; values: unknown[] }[] = [];
  const query: StudentDataQuery = async (text, values) => {
    calls.push({ text, values });
    if (text.includes("create_student_profile_item")) return [{ item_id: "71" }];
    return [{ updated: true, deleted: true, snapshot_id: "91", snapshot: { id: 91 } }];
  };
  const item = { kind: "project", title: "  Campus map  ", summary: "  Mapped routes. ", tags: [" research "] };
  assert.deepEqual(cleanProfileItemContent(item), { kind: "project", title: "Campus map", summary: "Mapped routes.", tags: ["research"] });
  assert.equal(await createStudentProfileItem(query, digest, item), "71");
  assert.equal(await createStudentProfileItem(query, digest, item, { kind: "cv_import", reference: "cv-session-7", excerpt: "Campus map" }), "71");
  assert.equal(await updateStudentProfileItem(query, digest, "71", { ...item, outcome: "Published" }), true);
  assert.equal(await setStudentProfileItemConfirmation(query, digest, "71", "confirmed"), true);
  assert.equal(await deleteStudentProfileItem(query, digest, "71"), true);
  assert.equal(await createStudentProfileSnapshot(query, digest, "application_preparation", "Application", ["71"]), "91");
  assert.deepEqual(await readStudentProfileSnapshot(query, digest, "91"), { id: 91 });
  assert.ok(calls.every((call) => call.text.includes("$1") && !call.text.includes(digest)));
  assert.equal(calls[1].values[2], "cv_import");
  assert.equal(calls[1].values[3], "cv-session-7");

  const never: StudentDataQuery = async () => { assert.fail("storage must not run"); };
  await assert.rejects(createStudentProfileItem(never, digest, { kind: "story", title: "" }));
  await assert.rejects(createStudentProfileItem(never, digest, item, { kind: "cv_import" }));
  await assert.rejects(createStudentProfileItem(never, digest, item, { reference: "manual-source" }));
  await assert.rejects(createStudentProfileItem(never, digest, item, { kind: "ai_derived_candidate" as never, reference: "model-run-1" }));
  await assert.rejects(updateStudentProfileItem(never, digest, "0", item));
  await assert.rejects(setStudentProfileItemConfirmation(never, digest, "71", "candidate" as never));
  await assert.rejects(createStudentProfileSnapshot(never, digest, "application_preparation", " ", ["71"]));
});

test("vault and matching reads remain purpose-specific", async () => {
  const calls: { text: string; values: unknown[] }[] = [];
  const query: StudentDataQuery = async (text, values) => {
    calls.push({ text, values });
    if (text.includes("profile_vault")) return [{ vault: { items: [] } }];
    if (text.includes("profile_snapshots")) return [{ snapshots: [{ id: 91 }] }];
    return [{ facts: { subject: profile.facts.subject } }];
  };
  assert.deepEqual(await readStudentProfileVault(query, digest), { items: [] });
  assert.deepEqual(await readStudentProfileSnapshots(query, digest), [{ id: 91 }]);
  assert.deepEqual(await readStudentMatchingFacts(query, digest, ["subject"]), { subject: profile.facts.subject });
  assert.deepEqual(calls[2].values, [digest, ["subject"]]);
  const never: StudentDataQuery = async () => { assert.fail("storage must not run"); };
  await assert.rejects(readStudentMatchingFacts(never, digest, ["private_note" as never]));
});
