import assert from "node:assert/strict";
import test from "node:test";
import { deliverReminders, listVerifiedUsers, reminderDates, remindersReady, type ReminderEnv } from "../lib/email-reminders.server";
import { publicDetails } from "../lib/public-details";
import { studentSubjectDigest, type StudentDataQuery } from "../lib/student-progress.server";

const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const issuer = "https://api.workos.com/user_management/client_test";
const env: ReminderEnv = {
  SCHOLARABLE_EMAIL_ENABLED: "true", SCHOLARABLE_EMAIL_REMINDERS_ENABLED: "true", SCHOLARABLE_STUDENT_AUTH_ENABLED: "true",
  SCHOLARABLE_EMAIL_DATABASE_URL: "postgres://sender", SCHOLARABLE_SERVING_DATABASE_URL: "postgres://serving",
  SCHOLARABLE_STUDENT_IDENTITY_KEY: key, SCHOLARABLE_REMINDER_ISSUER: issuer,
  SCHOLARABLE_EMAIL_UNSUBSCRIBE_KEY: key,
  SCHOLARABLE_PUBLIC_ORIGIN: "https://scholarable.example", WORKOS_API_KEY: "test-key",
  RESEND_API_KEY: "test-sender", RESEND_FROM: "Scholarable <dates@scholarable.example>",
};
const window = (id: string, deadline_on: string, track_id: string | null = null) => ({ id, track_id, route_id: null,
  window_type: "application", deadline_on, deadline_precision: "date_only" });

test("reminder gate needs full config and deliberately excludes scoped, estimated and distant dates", () => {
  assert.equal(remindersReady(env), true);
  assert.equal(remindersReady({ ...env, SCHOLARABLE_EMAIL_REMINDERS_ENABLED: "false" }), false);
  assert.equal(remindersReady({ ...env, SCHOLARABLE_EMAIL_ENABLED: "false" }), false);
  assert.equal(remindersReady({ ...env, SCHOLARABLE_PUBLIC_ORIGIN: "http://scholarable.example" }), false);
  const details = publicDetails({ tracks: [{ id: "master", label: "Master" }], windows: [
    window("seven", "2027-05-27"), window("one", "2027-05-21"), window("scoped", "2027-05-27", "master"),
    { ...window("estimated", "2027-05-27"), deadline_precision: "estimated" }, window("later", "2027-06-10"),
  ] });
  assert.deepEqual(reminderDates(details, "2027-05-20").map(date => date.id), ["one", "seven"]);
});

test("WorkOS lookup uses bounded pagination and rejects truncated or malformed lists", async () => {
  const seen: string[] = [];
  const request: typeof fetch = async (input) => {
    const url = new URL(String(input)); seen.push(url.searchParams.get("after") || "");
    return Response.json(url.searchParams.has("after")
      ? { data: [{ id: "user_two", email: "two@example.org", email_verified: false }], list_metadata: { after: null } }
      : { data: [{ id: "user_one", email: "one@example.org", email_verified: true }], list_metadata: { after: "cursor" } });
  };
  assert.deepEqual(await listVerifiedUsers("test-key", request), [{ id: "user_one", email: "one@example.org", email_verified: true }]);
  assert.deepEqual(seen, ["", "cursor"]);
  await assert.rejects(listVerifiedUsers("test-key", async () => Response.json({ data: [] })), /invalid/);
  await assert.rejects(listVerifiedUsers("test-key", async () => Response.json({ data: [], list_metadata: { after: "loop" } })), /capacity/);
});

test("only opted-in, current general dates make a reserved send; no recipient or opt-out never sends", async () => {
  const digest = await studentSubjectDigest({ issuer, subject: "user_one" }, key);
  const candidates = [{ subject_digest_hex: digest, call_id: "42" }];
  const calls = [{ id: 42, slug: "sample-call", title: "Sample call", details: { windows: [window("general", "2027-05-27"), window("scoped", "2027-05-27", "master")] } }];
  let reserved = true;
  const database: StudentDataQuery = async (sql) => sql.includes("list_student_reminder_candidates") ? candidates : [{ reserved }];
  const statements: string[] = [];
  const query: StudentDataQuery = async (sql, values) => { statements.push(sql); return database(sql, values); };
  const mails: unknown[] = [];
  const request: typeof fetch = async (input, init) => {
    if (String(input).includes("workos")) return Response.json({ data: [{ id: "user_one", email: "one@example.org", email_verified: true }], list_metadata: { after: null } });
    mails.push(JSON.parse(String(init?.body))); return Response.json({ id: "mail_1" });
  };
  const run = () => deliverReminders(env, new Date("2027-05-20T12:00:00Z"), request, async () => query, async () => async () => calls);
  assert.equal(await run(), 1);
  assert.equal(mails.length, 1);
  assert.match(JSON.stringify(mails[0]), /Sample call/);
  assert.doesNotMatch(JSON.stringify(mails[0]), /scoped|user_one/);
  assert.equal(statements.filter(sql => sql.includes("reserve_student_reminder")).length, 1);
  reserved = false;
  assert.equal(await run(), 0);
  assert.equal(mails.length, 1);
  assert.equal(await deliverReminders({ ...env, SCHOLARABLE_EMAIL_REMINDERS_ENABLED: "false" }, undefined, request), 0);
  const noConsent = () => deliverReminders(env, new Date("2027-05-20T12:00:00Z"), request,
    async () => async () => [], async () => async () => { assert.fail("No catalogue query on opt-out"); });
  assert.equal(await noConsent(), 0);
});
