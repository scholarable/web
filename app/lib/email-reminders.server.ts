import { deadlineWatch, todayInBerlin } from "./deadline-watch";
import { emailDatabaseQuery, emailIdempotencyKey, emailReady, sendEmail, unsubscribeUrl, type EmailEnv } from "./email.server";
import { publicDetails } from "./public-details";
import { servingQuery } from "./serving.server";
import { studentSubjectDigest, type StudentDataQuery } from "./student-progress.server";
import type { StudentAuthEnv } from "./student-auth.server";

export type ReminderEnv = StudentAuthEnv & EmailEnv & {
  SCHOLARABLE_EMAIL_REMINDERS_ENABLED?: string;
  SCHOLARABLE_REMINDER_ISSUER?: string;
};

export function remindersReady(env: ReminderEnv | undefined): boolean {
  if (!emailReady(env) || env?.SCHOLARABLE_EMAIL_REMINDERS_ENABLED !== "true" || env.SCHOLARABLE_STUDENT_AUTH_ENABLED !== "true") return false;
  try {
    const issuer = new URL(env.SCHOLARABLE_REMINDER_ISSUER || "");
    return issuer.protocol === "https:" && !issuer.username && !issuer.password
      && !!(env.SCHOLARABLE_SERVING_DATABASE_URL && env.SCHOLARABLE_STUDENT_IDENTITY_KEY && env.WORKOS_API_KEY);
  } catch { return false; }
}

export function reminderDates(details: ReturnType<typeof publicDetails>, today: string) {
  // Saved calls do not record a track or route choice; only general windows
  // may be described as relevant to every account holder.
  return details.windows.filter(window => !window.track_id && !window.route_id)
    .flatMap(window => deadlineWatch({ ...details, windows: [window] }, today))
    .filter(date => date.daysAway === 7 || date.daysAway === 1)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

type Recipient = { id: string; email: string; email_verified: boolean };
export async function listVerifiedUsers(apiKey: string, request: typeof fetch = fetch): Promise<Recipient[]> {
  const users: Recipient[] = [];
  let after: string | undefined;
  for (let page = 0; page < 6; page++) {
    const url = new URL("https://api.workos.com/user_management/users");
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const response = await request(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) throw new Error("WorkOS user lookup failed");
    const body = await response.json() as { data?: Recipient[]; list_metadata?: { after?: string | null } };
    if (!Array.isArray(body.data) || body.data.length > 100 || !body.list_metadata || !Object.hasOwn(body.list_metadata, "after")) throw new Error("WorkOS user list invalid");
    for (const user of body.data) {
      if (typeof user.id !== "string" || typeof user.email !== "string" || typeof user.email_verified !== "boolean") throw new Error("WorkOS user invalid");
      if (user.email_verified && /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(user.email)) users.push(user);
    }
    const next = body.list_metadata?.after;
    if (!next) return users;
    if (typeof next !== "string" || !body.data.length || next === after || page === 5) throw new Error("WorkOS user capacity exceeded");
    after = next;
  }
  throw new Error("WorkOS user capacity exceeded");
}

export async function deliverReminders(env: ReminderEnv, now = new Date(), request: typeof fetch = fetch,
  connect: (url: string) => Promise<StudentDataQuery> = emailDatabaseQuery,
  serve: (environment: ReminderEnv) => Promise<StudentDataQuery> = async environment => {
    const query = await servingQuery(environment);
    return (sql, values) => query(sql, values);
  }): Promise<number> {
  if (env.SCHOLARABLE_EMAIL_REMINDERS_ENABLED !== "true") return 0;
  if (!remindersReady(env)) throw new Error("Email reminders are not configured");
  const query = await connect(env.SCHOLARABLE_EMAIL_DATABASE_URL!);
  const candidates = await query("select subject_digest_hex, call_id from list_student_reminder_candidates()", []);
  if (candidates.length > 50) throw new Error("Reminder pilot capacity exceeded");
  if (!candidates.length) return 0;
  const publicQuery = await serve(env);
  const calls = await publicQuery(`select ready.id, ready.title, ready.slug, detail.details
    from application_ready_calls as ready join public_call_details as detail on detail.call_id = ready.id
    where ready.id = any($1::bigint[])`, [candidates.map(row => row.call_id)]);
  const byId = new Map(calls.map(row => [String(row.id), row]));
  const today = todayInBerlin(now);
  const due = candidates.flatMap(candidate => {
    const call = byId.get(String(candidate.call_id));
    if (!call || typeof candidate.subject_digest_hex !== "string" || !/^[a-f0-9]{64}$/.test(candidate.subject_digest_hex)) return [];
    return reminderDates(publicDetails(call.details), today).map(date => ({ candidate, call, date }));
  });
  if (due.length > 50) throw new Error("Reminder pilot capacity exceeded");
  if (!due.length) return 0;
  const users = await listVerifiedUsers(env.WORKOS_API_KEY!, request);
  const recipients = new Map<string, string>();
  for (const user of users) recipients.set(await studentSubjectDigest({ issuer: env.SCHOLARABLE_REMINDER_ISSUER!, subject: user.id }, env.SCHOLARABLE_STUDENT_IDENTITY_KEY!), user.email);
  let attempted = 0;
  for (const { candidate, call, date } of due) {
    const to = recipients.get(candidate.subject_digest_hex as string);
    if (!to || typeof call.title !== "string" || call.title.length > 160 || /[\r\n\u0000-\u001f]/.test(call.title)
      || typeof call.slug !== "string" || !/^[a-z0-9-]+$/.test(call.slug)) continue;
    const windowId = date.id;
    if (!windowId || windowId.length > 160) continue;
    const claim = await query("select reserve_student_reminder(decode($1, 'hex'), $2::bigint, $3, $4::date, $5::smallint) as reserved",
      [candidate.subject_digest_hex, candidate.call_id, windowId, date.date, date.daysAway]);
    if (claim[0]?.reserved !== true) continue;
    attempted++;
    const link = `${env.SCHOLARABLE_PUBLIC_ORIGIN}/scholarships/${encodeURIComponent(call.slug)}`;
    const stopUrl = await unsubscribeUrl(env, candidate.subject_digest_hex as string, "reminders");
    await sendEmail(env, { to, subject: `Frist prüfen: ${call.title}`,
      text: `${call.title}\n\n${date.timingDe || date.timing}\nDiese allgemeine Bewerbungsfrist ist in ${date.daysAway} ${date.daysAway === 1 ? "Tag" : "Tagen"} (Berliner Zeit). Prüf vor der Bewerbung das aktuelle Datum beim Anbieter und ob du die Voraussetzungen erfüllst.\n\n${link}\n\nErinnerungen ausschalten: ${stopUrl}`,
      idempotencyKey: await emailIdempotencyKey("reminder", candidate.subject_digest_hex as string, String(candidate.call_id), windowId, date.date, String(date.daysAway)),
      unsubscribeUrl: stopUrl }, request);
    // A reservation is never retried after an ambiguous provider response: no duplicate email.
  }
  return attempted;
}
