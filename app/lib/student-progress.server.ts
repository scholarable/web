import { neon } from "@neondatabase/serverless";
import type { MatchRequest } from "./contracts";
import { parseProfile } from "./matches.server";
import { cleanProfileItemContent, type ProfileItemSource, type StudentProfileVault } from "./profile-vault";
import { applicationWorkspace, type ApplicationWorkspaceData } from "./application-workspace";
import { answerLibrary, answerThemes, type AnswerLibraryItem, type AnswerTheme } from "./answer-library";

export type VerifiedStudentPrincipal = { issuer: string; subject: string };
export type StudentDataEnv = { SCHOLARABLE_STUDENT_DATABASE_URL?: string };
export type StudentDataQuery = (text: string, values: unknown[]) => Promise<Record<string, unknown>[]>;
type StudentDataConnect = (connectionString: string) => { query: StudentDataQuery };

function profileItemId(itemId: string): string {
  if (!/^[1-9][0-9]{0,17}$/.test(itemId)) throw new Error("Invalid profile item");
  return itemId;
}

function localTestDatabase(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    return url.protocol === "postgresql:" && url.hostname === "127.0.0.1"
      && url.pathname === "/scholarable_auth_test" && decodeURIComponent(url.username) === "scholarable_student_app";
  } catch { return false; }
}

function keyBytes(encoded: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("Student identity key unavailable");
  const padded = encoded.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  if (bytes.length < 32) throw new Error("Student identity key unavailable");
  return bytes.buffer as ArrayBuffer;
}

export async function studentSubjectDigest(principal: VerifiedStudentPrincipal, encodedKey: string): Promise<string> {
  if (!/^https:\/\/[^\s\u0000-\u001f]{1,500}$/.test(principal.issuer)
    || !principal.subject || principal.subject.length > 500 || /[\u0000-\u001f]/.test(principal.subject)) {
    throw new Error("Verified student identity required");
  }
  const key = await crypto.subtle.importKey("raw", keyBytes(encodedKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const message = new TextEncoder().encode(JSON.stringify([principal.issuer, principal.subject]));
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, message))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function studentDataQuery(env: StudentDataEnv | undefined, connect: StudentDataConnect = neon): Promise<StudentDataQuery> {
  if (!env?.SCHOLARABLE_STUDENT_DATABASE_URL) throw new Error("Student data connection unavailable");
  const connectionString = env.SCHOLARABLE_STUDENT_DATABASE_URL;
  const sql = import.meta.env?.DEV && localTestDatabase(connectionString) ? {
    // ponytail: one local connection per query; pool only if development load warrants it.
    query: async (text: string, values: unknown[]) => {
      const { Client } = await import("pg");
      const client = new Client({ connectionString, connectionTimeoutMillis: 3000 });
      await client.connect();
      try { return (await client.query(text, values)).rows; }
      finally { await client.end(); }
    },
  } : connect(connectionString);
  const roles = await sql.query("select current_user as role, session_user as session_role", []);
  if (roles[0]?.role !== "scholarable_student_app" || roles[0]?.session_role !== "scholarable_student_app") {
    throw new Error("Dedicated student data role required");
  }
  return sql.query.bind(sql);
}

export async function saveStudentProfile(query: StudentDataQuery, subjectDigest: string, profile: MatchRequest["profile"]) {
  const clean = parseProfile({ profile });
  await query("select save_student_profile(decode($1, 'hex'), $2::jsonb)", [subjectDigest, JSON.stringify(clean.facts)]);
}

export async function createStudentProfileItem(
  query: StudentDataQuery,
  subjectDigest: string,
  input: Record<string, unknown>,
  source: { kind?: ProfileItemSource; reference?: string; excerpt?: string; sensitivity?: "standard" | "moderate" } = {},
): Promise<string> {
  const content = cleanProfileItemContent(input);
  const kind = source.kind || "student_manual";
  if (!["student_manual", "cv_import", "linkedin_import"].includes(kind)) throw new Error("Invalid profile item");
  const reference = source.reference?.trim() || null;
  const excerpt = source.excerpt?.trim() || null;
  if (kind === "student_manual" && (reference || excerpt)) throw new Error("Invalid profile item");
  if (kind !== "student_manual" && (!reference || reference.length > 200)) throw new Error("Invalid profile item");
  if (excerpt && excerpt.length > 500) throw new Error("Invalid profile item");
  const rows = await query(
    "select create_student_profile_item(decode($1, 'hex'), $2::jsonb, $3, $4, $5, $6) as item_id",
    [subjectDigest, JSON.stringify(content), kind, reference, excerpt, source.sensitivity || "standard"],
  );
  return String(rows[0]?.item_id);
}

export async function updateStudentProfileItem(query: StudentDataQuery, subjectDigest: string, itemId: string, input: Record<string, unknown>): Promise<boolean> {
  const rows = await query(
    "select update_student_profile_item(decode($1, 'hex'), $2::bigint, $3::jsonb) as updated",
    [subjectDigest, profileItemId(itemId), JSON.stringify(cleanProfileItemContent(input))],
  );
  return rows[0]?.updated === true;
}

export async function setStudentProfileItemConfirmation(query: StudentDataQuery, subjectDigest: string, itemId: string, state: "confirmed" | "rejected"): Promise<boolean> {
  if (!(["confirmed", "rejected"] as string[]).includes(state)) throw new Error("Invalid profile item");
  const rows = await query(
    "select set_student_profile_item_confirmation(decode($1, 'hex'), $2::bigint, $3) as updated",
    [subjectDigest, profileItemId(itemId), state],
  );
  return rows[0]?.updated === true;
}

export async function deleteStudentProfileItem(query: StudentDataQuery, subjectDigest: string, itemId: string): Promise<boolean> {
  const rows = await query(
    "select delete_student_profile_item(decode($1, 'hex'), $2::bigint) as deleted",
    [subjectDigest, profileItemId(itemId)],
  );
  return rows[0]?.deleted === true;
}

export async function readStudentProfileVault(query: StudentDataQuery, subjectDigest: string): Promise<StudentProfileVault> {
  const rows = await query("select read_student_profile_vault(decode($1, 'hex')) as vault", [subjectDigest]);
  const vault = rows[0]?.vault;
  if (!vault || typeof vault !== "object" || !Array.isArray((vault as StudentProfileVault).items)) throw new Error("Student profile vault unavailable");
  return vault as StudentProfileVault;
}

export async function readStudentMatchingFacts(query: StudentDataQuery, subjectDigest: string, fields: (keyof MatchRequest["profile"]["facts"])[]) {
  const allowed = ["adult_confirmation", "institution", "degree_level", "subject", "semester_number", "milestone"];
  if (fields.length > allowed.length || fields.some((field) => !allowed.includes(field))) throw new Error("Invalid matching fields");
  const rows = await query("select read_student_matching_facts(decode($1, 'hex'), $2::text[]) as facts", [subjectDigest, fields]);
  return rows[0]?.facts as Partial<MatchRequest["profile"]["facts"]>;
}

export async function createStudentProfileSnapshot(query: StudentDataQuery, subjectDigest: string, purpose: "application_preparation" | "submission_history", label: string, itemIds: string[]): Promise<string> {
  if (!label.trim() || label.trim().length > 160 || !itemIds.length || itemIds.length > 100) throw new Error("Invalid profile snapshot");
  const ids = itemIds.map(profileItemId);
  const rows = await query(
    "select create_student_profile_snapshot(decode($1, 'hex'), $2, $3, $4::bigint[]) as snapshot_id",
    [subjectDigest, purpose, label.trim(), ids],
  );
  return String(rows[0]?.snapshot_id);
}

export async function readStudentProfileSnapshot(query: StudentDataQuery, subjectDigest: string, snapshotId: string): Promise<Record<string, unknown> | null> {
  const rows = await query(
    "select read_student_profile_snapshot(decode($1, 'hex'), $2::bigint) as snapshot",
    [subjectDigest, profileItemId(snapshotId)],
  );
  return rows[0]?.snapshot as Record<string, unknown> | null;
}

export async function readStudentProfileSnapshots(query: StudentDataQuery, subjectDigest: string): Promise<Record<string, unknown>[]> {
  const rows = await query("select read_student_profile_snapshots(decode($1, 'hex')) as snapshots", [subjectDigest]);
  const snapshots = rows[0]?.snapshots;
  if (!Array.isArray(snapshots)) throw new Error("Student profile snapshots unavailable");
  return snapshots as Record<string, unknown>[];
}

export async function setStudentOpportunity(query: StudentDataQuery, subjectDigest: string, callId: string, disposition: "saved" | "dismissed") {
  if (!/^[1-9][0-9]{0,17}$/.test(callId)) throw new Error("Invalid opportunity");
  await query("select set_student_opportunity(decode($1, 'hex'), $2::bigint, $3)", [subjectDigest, callId, disposition]);
}

export async function setStudentApplicationState(query: StudentDataQuery, subjectDigest: string, callId: string, state: "planned" | "preparing" | "submitted" | "interview" | "decision" | "completed") {
  if (!/^[1-9][0-9]{0,17}$/.test(callId)) throw new Error("Invalid opportunity");
  await query("select set_student_application_state(decode($1, 'hex'), $2::bigint, $3)", [subjectDigest, callId, state]);
}

export async function setStudentReminderConsent(query: StudentDataQuery, subjectDigest: string, enabled: boolean, policyVersion: string) {
  const policy = policyVersion.trim();
  if (!policy || policy.length > 80) throw new Error("Invalid reminder consent");
  await query("select set_student_reminder_consent(decode($1, 'hex'), $2, $3)", [subjectDigest, enabled, policy]);
}

export async function setStudentRecommendationEmailConsent(query: StudentDataQuery, subjectDigest: string, enabled: boolean, policyVersion: string) {
  const policy = policyVersion.trim();
  if (!policy || policy.length > 80) throw new Error("Invalid recommendation email consent");
  await query("select set_student_recommendation_email_consent(decode($1, 'hex'), $2, $3)", [subjectDigest, enabled, policy]);
}

export type StudentOutcome = "accepted" | "rejected" | "waitlisted" | "withdrawn";
export async function setStudentApplicationOutcome(query: StudentDataQuery, subjectDigest: string, callId: string, outcome: StudentOutcome | null) {
  if (!/^[1-9][0-9]{0,17}$/.test(callId)) throw new Error("Invalid opportunity");
  if (outcome !== null && !["accepted", "rejected", "waitlisted", "withdrawn"].includes(outcome)) throw new Error("Invalid outcome");
  await query("select set_student_application_outcome(decode($1, 'hex'), $2::bigint, $3)", [subjectDigest, callId, outcome]);
}

export type StudentProgress = {
  profile: MatchRequest["profile"]["facts"] | null;
  profile_provenance?: Record<string, import("./profile-vault").ProfileItem["provenance"]>;
  opportunities: { call_id: number; disposition: "saved" | "dismissed"; currently_available: boolean }[];
  applications: { call_id: number; state: "planned" | "preparing" | "submitted" | "interview" | "decision" | "completed" }[];
  outcomes: { call_id: number; outcome: StudentOutcome }[];
  email_reminders_enabled: boolean;
  recommendation_emails_enabled: boolean;
};

export async function readStudentProgress(query: StudentDataQuery, subjectDigest: string): Promise<StudentProgress> {
  const rows = await query("select read_student_progress(decode($1, 'hex')) as progress", [subjectDigest]);
  const progress = rows[0]?.progress;
  if (!progress || typeof progress !== "object") throw new Error("Student progress unavailable");
  return progress as StudentProgress;
}

export async function deleteStudentAccount(query: StudentDataQuery, subjectDigest: string): Promise<boolean> {
  const rows = await query("select delete_student_account(decode($1, 'hex')) as deleted", [subjectDigest]);
  return rows[0]?.deleted === true;
}

export async function deleteStudentApplication(query: StudentDataQuery, subjectDigest: string, callId: string): Promise<boolean> {
  if (!/^[1-9][0-9]{0,17}$/.test(callId)) throw new Error("Invalid opportunity");
  const rows = await query("select delete_student_application(decode($1, 'hex'), $2::bigint) as deleted", [subjectDigest, callId]);
  return rows[0]?.deleted === true;
}

const callId = (value: string) => {
  if (!/^[1-9][0-9]{0,17}$/.test(value)) throw new Error("Invalid application workspace");
  return value;
};
const editVersion = (value: number, allowZero = false) => {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new Error("Invalid application workspace");
  return value;
};

export async function createStudentApplicationWorkspace(query: StudentDataQuery, subjectDigest: string, value: string): Promise<boolean> {
  const rows = await query("select create_student_application_workspace(decode($1, 'hex'), $2::bigint) as created", [subjectDigest, callId(value)]);
  return rows[0]?.created === true;
}

export async function createStudentPracticeWorkspace(query: StudentDataQuery, subjectDigest: string, packet: Record<string, unknown>): Promise<boolean> {
  const rows = await query("select create_student_practice_workspace(decode($1, 'hex'), $2::jsonb) as created", [subjectDigest, JSON.stringify(packet)]);
  return rows[0]?.created === true;
}

export async function readStudentPracticeWorkspace(query: StudentDataQuery, subjectDigest: string): Promise<ApplicationWorkspaceData | null> {
  const rows = await query("select read_student_practice_workspace(decode($1, 'hex')) as workspace", [subjectDigest]);
  if (rows[0]?.workspace == null) return null;
  const workspace = applicationWorkspace(rows[0].workspace);
  if (!workspace) throw new Error("Practice workspace unavailable");
  return workspace;
}

export async function readStudentApplicationWorkspace(query: StudentDataQuery, subjectDigest: string, value: string): Promise<ApplicationWorkspaceData | null> {
  const rows = await query("select read_student_application_workspace(decode($1, 'hex'), $2::bigint) as workspace", [subjectDigest, callId(value)]);
  if (rows[0]?.workspace == null) return null;
  const workspace = applicationWorkspace(rows[0].workspace);
  if (!workspace) throw new Error("Application workspace unavailable");
  return workspace;
}

export async function readStudentApplicationWorkspaces(query: StudentDataQuery, subjectDigest: string): Promise<ApplicationWorkspaceData[]> {
  const rows = await query("select read_student_application_workspaces(decode($1, 'hex')) as workspaces", [subjectDigest]);
  if (!Array.isArray(rows[0]?.workspaces)) throw new Error("Application workspaces unavailable");
  return rows[0].workspaces.map(item => {
    const workspace = applicationWorkspace(item);
    if (!workspace) throw new Error("Application workspaces unavailable");
    return workspace;
  });
}

export async function refreshStudentApplicationWorkspace(query: StudentDataQuery, subjectDigest: string, value: string, expectedVersion: number): Promise<number> {
  const rows = await query("select refresh_student_application_workspace(decode($1, 'hex'), $2::bigint, $3) as version", [subjectDigest, callId(value), editVersion(expectedVersion)]);
  return Number(rows[0]?.version);
}

export async function setStudentApplicationScope(query: StudentDataQuery, subjectDigest: string, value: string, trackId: string | null, routeId: string, expectedVersion: number): Promise<number> {
  if (trackId != null && (!trackId || trackId.length > 100) || !routeId || routeId.length > 100) throw new Error("Invalid application route");
  const rows = await query("select set_student_application_scope(decode($1, 'hex'), $2::bigint, $3, $4, $5) as version",
    [subjectDigest, callId(value), trackId, routeId, editVersion(expectedVersion)]);
  return Number(rows[0]?.version);
}

export async function updateStudentApplicationNote(query: StudentDataQuery, subjectDigest: string, value: string, note: string, expectedVersion: number): Promise<number> {
  if (note.length > 20000) throw new Error("Invalid application note");
  const rows = await query("select update_student_application_note(decode($1, 'hex'), $2::bigint, $3, $4) as version", [subjectDigest, callId(value), note, editVersion(expectedVersion)]);
  return Number(rows[0]?.version);
}

export type DraftState = "not_started" | "drafting" | "ready_for_review" | "approved";
export async function updateStudentApplicationDraft(query: StudentDataQuery, subjectDigest: string, value: string, questionId: string, answer: string, state: DraftState, expectedVersion: number): Promise<number> {
  if (!questionId || questionId.length > 100 || answer.length > 20000
    || !["not_started", "drafting", "ready_for_review", "approved"].includes(state)) throw new Error("Invalid application draft");
  const rows = await query("select update_student_application_draft(decode($1, 'hex'), $2::bigint, $3, $4, $5, $6) as version",
    [subjectDigest, callId(value), questionId, answer, state, editVersion(expectedVersion, true)]);
  return Number(rows[0]?.version);
}

export type DocumentState = "not_started" | "ready" | "not_applicable";
export async function updateStudentApplicationDocument(query: StudentDataQuery, subjectDigest: string, value: string, documentId: string, state: DocumentState, expectedVersion: number): Promise<number> {
  if (!documentId || documentId.length > 100 || !["not_started", "ready", "not_applicable"].includes(state)) throw new Error("Invalid application document state");
  const rows = await query("select update_student_application_document(decode($1, 'hex'), $2::bigint, $3, $4, $5) as version",
    [subjectDigest, callId(value), documentId, state, editVersion(expectedVersion, true)]);
  return Number(rows[0]?.version);
}

export async function captureStudentApplicationSubmission(query: StudentDataQuery, subjectDigest: string, value: string): Promise<string> {
  const rows = await query("select capture_student_application_submission(decode($1, 'hex'), $2::bigint) as snapshot_id", [subjectDigest, callId(value)]);
  return String(rows[0]?.snapshot_id);
}

export async function deleteStudentApplicationWorkspace(query: StudentDataQuery, subjectDigest: string, value: string): Promise<boolean> {
  const rows = await query("select delete_student_application_workspace(decode($1, 'hex'), $2::bigint) as deleted", [subjectDigest, callId(value)]);
  return rows[0]?.deleted === true;
}

// One SQL statement: matching facts and reviewed evidence either all save or all roll back.
export async function saveDiscoveryContext(query: StudentDataQuery, digest: string, input: unknown) {
  if (!input || typeof input !== "object") throw new Error("Invalid profile");
  const context = input as import("./discovery-context").DiscoveryContext;
  if (typeof context.id !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(context.id)
    || !Number.isFinite(context.expiresAt) || context.expiresAt <= Date.now()
    || context.expiresAt > Date.now() + 24 * 60 * 60 * 1000
    || !Array.isArray(context.items) || context.items.length > 60
    || context.sources !== undefined && (!context.sources || typeof context.sources !== "object" || Array.isArray(context.sources))) throw new Error("Invalid profile");
  const profile = parseProfile({ profile: context.profile });
  const items = context.items.map(item => {
    if (!item || !item.content || typeof item.content !== "object" || !["student_manual", "cv_import"].includes(item.source)) throw new Error("Invalid profile item");
    if (item.source === "cv_import" && (typeof item.reference !== "string" || !item.reference.trim() || item.reference.length > 160
      || typeof item.excerpt !== "string" || !item.excerpt.trim() || item.excerpt.length > 500)) throw new Error("Invalid profile item");
    return { content: cleanProfileItemContent(item.content), source: item.source,
      reference: item.source === "cv_import" ? `${context.id}:${item.reference}` : null,
      excerpt: item.source === "cv_import" ? item.excerpt : null };
  });
  const sources = Object.fromEntries(Object.entries(context.sources || {}).map(([field, source]) => {
    if (!Object.hasOwn(profile.facts, field) || !source || !["student_manual", "cv_import"].includes(source.source)
      || field === "adult_confirmation" && source.source !== "student_manual"
      || source.source === "cv_import" && (typeof source.reference !== "string" || !source.reference.trim() || source.reference.length > 160)) throw new Error("Invalid profile");
    return [field, { source: source.source, ...(source.source === "cv_import" ? { reference: `${context.id}:${source.reference}` } : {}) }];
  }));
  await query("select save_student_discovery_context(decode($1, 'hex'), $2::jsonb, $3::jsonb, $4::jsonb)",
    [digest, JSON.stringify(profile.facts), JSON.stringify(items), JSON.stringify(sources)]);
}

const libraryId = (value: string) => {
  if (!/^[1-9][0-9]{0,17}$/.test(value)) throw new Error("Invalid answer library item");
  return value;
};
const libraryThemes = (values: AnswerTheme[]) => {
  if (values.length > 8 || new Set(values).size !== values.length || values.some(value => !answerThemes.includes(value)))
    throw new Error("Invalid answer themes");
  return values;
};
const linkedProfileIds = (values: string[]) => {
  if (values.length > 20 || new Set(values).size !== values.length) throw new Error("Invalid linked profile items");
  return values.map(profileItemId);
};

export async function readStudentAnswerLibrary(query: StudentDataQuery, digest: string): Promise<AnswerLibraryItem[]> {
  const rows = await query("select read_student_answer_library(decode($1, 'hex')) as library", [digest]);
  const library = answerLibrary(rows[0]?.library);
  if (!library) throw new Error("Answer library unavailable");
  return library;
}

export async function saveStudentAnswerToLibrary(query: StudentDataQuery, digest: string, call: string,
  questionId: string, themes: AnswerTheme[], profileIds: string[]): Promise<string> {
  if (!questionId || questionId.length > 100) throw new Error("Invalid answer library item");
  const rows = await query("select save_student_answer_to_library(decode($1, 'hex'), $2::bigint, $3, $4::text[], $5::bigint[]) as item_id",
    [digest, callId(call), questionId, libraryThemes(themes), linkedProfileIds(profileIds)]);
  return String(rows[0]?.item_id);
}

export async function updateStudentLibraryAnswer(query: StudentDataQuery, digest: string, item: string,
  answer: string, themes: AnswerTheme[], profileIds: string[], expectedVersion: number): Promise<number> {
  if (!answer.trim() || answer.length > 20000) throw new Error("Invalid answer library edit");
  const rows = await query("select update_student_library_answer(decode($1, 'hex'), $2::bigint, $3, $4::text[], $5::bigint[], $6) as version",
    [digest, libraryId(item), answer, libraryThemes(themes), linkedProfileIds(profileIds), editVersion(expectedVersion)]);
  return Number(rows[0]?.version);
}

export async function setStudentLibraryArchive(query: StudentDataQuery, digest: string, item: string, archived: boolean): Promise<boolean> {
  const rows = await query("select set_student_library_archive(decode($1, 'hex'), $2::bigint, $3) as changed", [digest, libraryId(item), archived]);
  return rows[0]?.changed === true;
}

export async function updateStudentLibraryReflection(query: StudentDataQuery, digest: string, item: string,
  reflection: { interview_invitation?: boolean; feedback?: string; outcome?: "accepted" | "rejected" | "waitlisted" | "withdrawn"; lessons?: string }, expectedVersion: number): Promise<number> {
  if (reflection.feedback && reflection.feedback.length > 2000 || reflection.lessons && reflection.lessons.length > 2000)
    throw new Error("Invalid answer reflection");
  const rows = await query("select update_student_library_reflection(decode($1, 'hex'), $2::bigint, $3::jsonb, $4) as version",
    [digest, libraryId(item), JSON.stringify(reflection), editVersion(expectedVersion, true)]);
  return Number(rows[0]?.version);
}

export async function deleteStudentLibraryAnswer(query: StudentDataQuery, digest: string, item: string): Promise<boolean> {
  const rows = await query("select delete_student_library_answer(decode($1, 'hex'), $2::bigint) as deleted", [digest, libraryId(item)]);
  return rows[0]?.deleted === true;
}

export async function clearStudentAnswerLibrary(query: StudentDataQuery, digest: string): Promise<number> {
  const rows = await query("select clear_student_answer_library(decode($1, 'hex')) as deleted", [digest]);
  return Number(rows[0]?.deleted);
}
