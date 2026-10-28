import { neon } from "@neondatabase/serverless";
import type { StudentDataQuery } from "./student-progress.server";

export type EmailCategory = "recommendations" | "reminders";

export type EmailEnv = {
  SCHOLARABLE_EMAIL_ENABLED?: string;
  SCHOLARABLE_EMAIL_DATABASE_URL?: string;
  SCHOLARABLE_EMAIL_UNSUBSCRIBE_KEY?: string;
  SCHOLARABLE_PUBLIC_ORIGIN?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_REPLY_TO?: string;
};

const validEmail = (value: string | undefined) => !!value && /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(value);

function keyBytes(encoded: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("Email unsubscribe key unavailable");
  const padded = encoded.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  if (bytes.length < 32) throw new Error("Email unsubscribe key unavailable");
  return bytes.buffer as ArrayBuffer;
}

export function emailPreferencesReady(env: EmailEnv | undefined): boolean {
  try {
    const origin = new URL(env?.SCHOLARABLE_PUBLIC_ORIGIN || "");
    keyBytes(env?.SCHOLARABLE_EMAIL_UNSUBSCRIBE_KEY || "");
    return origin.protocol === "https:" && !origin.username && !origin.password
      && origin.origin === origin.href.replace(/\/$/, "")
      && !!env?.SCHOLARABLE_EMAIL_DATABASE_URL;
  } catch { return false; }
}

export function emailReady(env: EmailEnv | undefined): boolean {
  if (env?.SCHOLARABLE_EMAIL_ENABLED !== "true" || !emailPreferencesReady(env)) return false;
  try {
    return !!(env.RESEND_API_KEY && env.RESEND_FROM)
      && !/[\r\n]/.test(env.RESEND_FROM || "")
      && (!env.RESEND_REPLY_TO || validEmail(env.RESEND_REPLY_TO));
  } catch { return false; }
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

const decodeBase64url = (value: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid unsubscribe link");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
};

async function signingKey(encoded: string) {
  return crypto.subtle.importKey("raw", keyBytes(encoded), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createUnsubscribeToken(subjectDigest: string, category: EmailCategory, encodedKey: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(subjectDigest)) throw new Error("Invalid email recipient");
  const payload = new TextEncoder().encode(`v1:${category}:${subjectDigest}`);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(encodedKey), payload));
  return `${base64url(payload)}.${base64url(signature)}`;
}

export async function verifyUnsubscribeToken(token: string, encodedKey: string): Promise<{ category: EmailCategory; subjectDigest: string }> {
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) throw new Error("Invalid unsubscribe link");
  const payload = decodeBase64url(encodedPayload);
  const signature = decodeBase64url(encodedSignature);
  if (!await crypto.subtle.verify("HMAC", await signingKey(encodedKey), signature, payload)) throw new Error("Invalid unsubscribe link");
  const match = /^v1:(recommendations|reminders):([a-f0-9]{64})$/.exec(new TextDecoder().decode(payload));
  if (!match) throw new Error("Invalid unsubscribe link");
  return { category: match[1] as EmailCategory, subjectDigest: match[2] };
}

export async function unsubscribeUrl(env: EmailEnv, subjectDigest: string, category: EmailCategory): Promise<string> {
  const token = await createUnsubscribeToken(subjectDigest, category, env.SCHOLARABLE_EMAIL_UNSUBSCRIBE_KEY!);
  return `${env.SCHOLARABLE_PUBLIC_ORIGIN}/email/unsubscribe?token=${encodeURIComponent(token)}`;
}

export async function emailDatabaseQuery(url: string): Promise<StudentDataQuery> {
  const sql = neon(url);
  const roles = await sql.query("select current_user as role, session_user as session_role", []);
  if (roles[0]?.role !== "scholarable_reminder_sender" || roles[0]?.session_role !== "scholarable_reminder_sender") {
    throw new Error("Dedicated email role required");
  }
  return sql.query.bind(sql);
}

export async function unsubscribeStudentEmail(env: EmailEnv, token: string,
  connect: (url: string) => Promise<StudentDataQuery> = emailDatabaseQuery): Promise<EmailCategory> {
  if (!emailPreferencesReady(env)) throw new Error("Email preferences are not configured");
  const { category, subjectDigest } = await verifyUnsubscribeToken(token, env.SCHOLARABLE_EMAIL_UNSUBSCRIBE_KEY!);
  const query = await connect(env.SCHOLARABLE_EMAIL_DATABASE_URL!);
  const rows = await query("select unsubscribe_student_email(decode($1, 'hex'), $2) as changed", [subjectDigest, category]);
  if (rows[0]?.changed !== true) throw new Error("Email preference unavailable");
  return category;
}

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  idempotencyKey: string;
  unsubscribeUrl: string;
};

export async function emailIdempotencyKey(prefix: string, ...parts: string[]): Promise<string> {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(prefix)) throw new Error("Invalid email key");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts))));
  return `${prefix}-${[...hash].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function sendEmail(env: EmailEnv, message: OutgoingEmail, request: typeof fetch = fetch): Promise<string> {
  if (!emailReady(env)) throw new Error("Email is not configured");
  if (!validEmail(message.to) || !message.subject.trim() || message.subject.length > 200 || /[\r\n]/.test(message.subject)
    || !message.text.trim() || message.text.length > 100_000
    || (message.html != null && (!message.html.trim() || message.html.length > 200_000))
    || !/^[A-Za-z0-9._:-]{1,200}$/.test(message.idempotencyKey)) throw new Error("Invalid email");
  const unsubscribe = new URL(message.unsubscribeUrl);
  if (unsubscribe.origin !== env.SCHOLARABLE_PUBLIC_ORIGIN || unsubscribe.pathname !== "/email/unsubscribe") throw new Error("Invalid unsubscribe link");
  const response = await request("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": message.idempotencyKey },
    body: JSON.stringify({ from: env.RESEND_FROM, to: [message.to], subject: message.subject, text: message.text,
      ...(message.html ? { html: message.html } : {}), ...(env.RESEND_REPLY_TO ? { reply_to: env.RESEND_REPLY_TO } : {}),
      headers: { "List-Unsubscribe": `<${message.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }),
  });
  if (!response.ok) throw new Error("Email provider rejected an attempt");
  const body = await response.json() as { id?: unknown };
  if (typeof body.id !== "string" || !body.id) throw new Error("Email provider response invalid");
  return body.id;
}

export async function sendWelcomeEmail(env: EmailEnv, subjectDigest: string, to: string, request: typeof fetch = fetch,
  connect: (url: string) => Promise<StudentDataQuery> = emailDatabaseQuery): Promise<boolean> {
  if (!emailReady(env)) throw new Error("Email is not configured");
  const query = await connect(env.SCHOLARABLE_EMAIL_DATABASE_URL!);
  const key = "welcome-v1";
  const reservation = await query("select reserve_student_email(decode($1, 'hex'), 'welcome', $2) as reserved", [subjectDigest, key]);
  if (reservation[0]?.reserved !== true) return false;
  const stopUrl = await unsubscribeUrl(env, subjectDigest, "recommendations");
  const content = welcomeEmail(`${env.SCHOLARABLE_PUBLIC_ORIGIN}/account`, stopUrl);
  await sendEmail(env, { to, ...content, idempotencyKey: await emailIdempotencyKey("welcome", subjectDigest, key), unsubscribeUrl: stopUrl }, request);
  return true;
}

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function welcomeEmail(accountUrl: string, stopUrl: string) {
  return {
    subject: "Deine Stipendien-E-Mails von Scholarable sind an",
    text: `Du hast personalisierte Stipendien-E-Mails eingeschaltet. Wir schreiben dir nur, wenn es etwas Nützliches gibt.\n\nE-Mail-Einstellungen ändern: ${accountUrl}\nDiese E-Mails abbestellen: ${stopUrl}`,
    html: `<h1>Deine Stipendien-E-Mails von Scholarable sind an</h1><p>Du hast personalisierte Stipendien-E-Mails eingeschaltet. Wir schreiben dir nur, wenn es etwas Nützliches gibt.</p><p><a href="${escapeHtml(accountUrl)}">E-Mail-Einstellungen ändern</a></p><p><a href="${escapeHtml(stopUrl)}">Diese E-Mails abbestellen</a></p>`,
  };
}
