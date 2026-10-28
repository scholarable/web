import assert from "node:assert/strict";
import test from "node:test";
import {
  createUnsubscribeToken, emailPreferencesReady, emailReady, sendEmail, sendWelcomeEmail,
  unsubscribeStudentEmail, unsubscribeUrl, verifyUnsubscribeToken, type EmailEnv,
} from "../lib/email.server";
import type { StudentDataQuery } from "../lib/student-progress.server";

const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const digest = "11".repeat(32);
const env: EmailEnv = {
  SCHOLARABLE_EMAIL_ENABLED: "true",
  SCHOLARABLE_EMAIL_DATABASE_URL: "postgres://sender",
  SCHOLARABLE_EMAIL_UNSUBSCRIBE_KEY: key,
  SCHOLARABLE_PUBLIC_ORIGIN: "https://scholarable.example",
  RESEND_API_KEY: "test-key",
  RESEND_FROM: "Scholarable <updates@scholarable.example>",
  RESEND_REPLY_TO: "help@scholarable.example",
};

test("email stays off until every delivery and unsubscribe setting is valid", () => {
  assert.equal(emailReady(env), true);
  assert.equal(emailReady({ ...env, SCHOLARABLE_EMAIL_ENABLED: "false" }), false);
  assert.equal(emailPreferencesReady({ ...env, SCHOLARABLE_EMAIL_ENABLED: "false", RESEND_API_KEY: undefined }), true);
  assert.equal(emailReady({ ...env, SCHOLARABLE_EMAIL_UNSUBSCRIBE_KEY: "short" }), false);
  assert.equal(emailReady({ ...env, SCHOLARABLE_PUBLIC_ORIGIN: "http://scholarable.example" }), false);
  assert.equal(emailReady({ ...env, RESEND_FROM: "Scholarable\r\nBcc: attacker@example.org" }), false);
});

test("unsubscribe tokens are purpose-bound and reject tampering", async () => {
  const token = await createUnsubscribeToken(digest, "recommendations", key);
  assert.deepEqual(await verifyUnsubscribeToken(token, key), { category: "recommendations", subjectDigest: digest });
  await assert.rejects(verifyUnsubscribeToken(`${token.slice(0, -1)}x`, key), /Invalid unsubscribe link/);
  await assert.rejects(createUnsubscribeToken("not-a-digest", "reminders", key), /Invalid email recipient/);
});

test("Resend receives an idempotency key and one-click unsubscribe headers", async () => {
  const stopUrl = await unsubscribeUrl(env, digest, "recommendations");
  let requestInit: RequestInit | undefined;
  const request: typeof fetch = async (_input, init) => { requestInit = init; return Response.json({ id: "email_1" }); };
  assert.equal(await sendEmail(env, { to: "student@example.org", subject: "A useful update", text: "Hello",
    idempotencyKey: "digest-2026-39", unsubscribeUrl: stopUrl }, request), "email_1");
  assert.equal((requestInit?.headers as Record<string, string>)["Idempotency-Key"], "digest-2026-39");
  const body = JSON.parse(String(requestInit?.body));
  assert.equal(body.headers["List-Unsubscribe"], `<${stopUrl}>`);
  assert.equal(body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.equal(body.reply_to, "help@scholarable.example");
});

test("welcome delivery reserves once and unsubscribe changes only the token category", async () => {
  const statements: string[] = [];
  const query: StudentDataQuery = async (sql) => {
    statements.push(sql);
    if (sql.includes("reserve_student_email")) return [{ reserved: true }];
    return [{ changed: true }];
  };
  const request: typeof fetch = async () => Response.json({ id: "email_welcome" });
  assert.equal(await sendWelcomeEmail(env, digest, "student@example.org", request, async () => query), true);
  const token = await createUnsubscribeToken(digest, "reminders", key);
  assert.equal(await unsubscribeStudentEmail({ ...env, SCHOLARABLE_EMAIL_ENABLED: "false", RESEND_API_KEY: undefined }, token, async () => query), "reminders");
  assert.equal(statements.filter(sql => sql.includes("reserve_student_email")).length, 1);
  assert.equal(statements.filter(sql => sql.includes("unsubscribe_student_email")).length, 1);
});
