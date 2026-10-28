import type { StudentDataQuery } from "./student-progress.server";
import { emailDatabaseQuery } from "./email.server";
import { todayInBerlin } from "./deadline-watch";

export const documentCategories = ["cv", "transcript", "certificate", "recommendation"] as const;
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export type DocumentCategory = typeof documentCategories[number];
export type PrivateDocument = { id: string; name: string; category: DocumentCategory; version: number; latest_version: number; size: number; review_on: string | null; created_at: string; links: string[];
  review_due: boolean; versions: { version: number; review_on: string | null; review_due: boolean; replaced_at: string | null }[] };
export type DocumentEnv = {
  SCHOLARABLE_DOCUMENTS_ENABLED?: string;
  SCHOLARABLE_DOCUMENT_KEY?: string;
  SCHOLARABLE_DOCUMENT_PILOT_DIGESTS?: string;
  SCHOLARABLE_DOCUMENT_CLEANUP_ENABLED?: string;
  SCHOLARABLE_EMAIL_DATABASE_URL?: string;
  SCHOLARABLE_DOCUMENT_SCANNER?: { fetch(request: Request): Promise<Response> };
};

export function documentEnv(context: unknown): DocumentEnv {
  return (context as { cloudflare?: { env?: DocumentEnv } })?.cloudflare?.env || {};
}

export function documentsReady(env: DocumentEnv): boolean {
  return env.SCHOLARABLE_DOCUMENTS_ENABLED === "true" && /^[0-9a-f]{64}$/.test(env.SCHOLARABLE_DOCUMENT_KEY || "");
}

export function documentPilotAllowed(env: DocumentEnv, digest: string): boolean {
  const pilot = env.SCHOLARABLE_DOCUMENT_PILOT_DIGESTS || "";
  return /^[0-9a-f]{64}(?:,[0-9a-f]{64}){0,9}$/.test(pilot) && pilot.split(",").includes(digest);
}

export async function cleanupDocuments(env: DocumentEnv, connect = emailDatabaseQuery): Promise<void> {
  if (env.SCHOLARABLE_DOCUMENT_CLEANUP_ENABLED !== "true") return;
  if (!env.SCHOLARABLE_EMAIL_DATABASE_URL) throw new Error("Document cleanup database unavailable");
  const query = await connect(env.SCHOLARABLE_EMAIL_DATABASE_URL);
  await query("select cleanup_student_documents()", []);
}

function id(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new Response("Invalid document", { status: 400 });
  return value;
}
function reviewDate(value: FormDataEntryValue | null): string | null {
  const date = String(value || "");
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date <= todayInBerlin(new Date()))) throw new Response("Choose a valid future review date", { status: 400 });
  return date || null;
}
function hex(bytes: Uint8Array): string { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
function unhex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})+$/.test(value)) throw new Error("Document unavailable");
  return Uint8Array.from(value.match(/../g)!, part => Number.parseInt(part, 16));
}

// Each account, document, and version is authenticated as part of the ciphertext.
export async function documentCipher(env: DocumentEnv, digest: string, documentId: string, version: number, bytes: Uint8Array<ArrayBuffer>, decrypt = false): Promise<Uint8Array<ArrayBuffer>> {
  if (!/^[0-9a-f]{64}$/.test(env.SCHOLARABLE_DOCUMENT_KEY || "") || !/^[0-9a-f]{64}$/.test(digest) || !Number.isSafeInteger(version) || version < 1) throw new Error("Document unavailable");
  const key = await crypto.subtle.importKey("raw", unhex(env.SCHOLARABLE_DOCUMENT_KEY!), "AES-GCM", false, ["encrypt", "decrypt"]);
  const iv = decrypt ? bytes.slice(0, 12) : crypto.getRandomValues(new Uint8Array(12));
  const algorithm = { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(JSON.stringify([digest, id(documentId), version])) };
  if (decrypt) return new Uint8Array(await crypto.subtle.decrypt(algorithm, key, bytes.slice(12)));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(algorithm, key, bytes));
  const result = new Uint8Array(iv.length + encrypted.length); result.set(iv); result.set(encrypted, iv.length); return result;
}

export async function boundedDocumentForm(request: Request): Promise<FormData> {
  if (!request.headers.get("Content-Type")?.startsWith("multipart/form-data;")) throw new Response("Upload form required", { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) throw new Response("Upload required", { status: 400 });
  const chunks: Uint8Array<ArrayBuffer>[] = []; let length = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.length;
      if (length > DOCUMENT_MAX_BYTES + 64 * 1024) throw new Response("Upload exceeds 5 MB", { status: 413 });
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return await new Response(bytes, { headers: { "Content-Type": request.headers.get("Content-Type")! } }).formData(); }
  catch { throw new Response("Upload could not be read", { status: 400 }); }
}

export async function readDocuments(query: StudentDataQuery, digest: string): Promise<PrivateDocument[]> {
  const rows = await query("select read_student_documents(decode($1, 'hex')) as documents", [digest]);
  if (!Array.isArray(rows[0]?.documents)) throw new Error("Document library unavailable");
  return rows[0].documents as PrivateDocument[];
}

export async function saveDocument(query: StudentDataQuery, digest: string, env: DocumentEnv, form: FormData): Promise<void> {
  if (!documentsReady(env) || env.SCHOLARABLE_DOCUMENT_CLEANUP_ENABLED !== "true" || !env.SCHOLARABLE_EMAIL_DATABASE_URL || !env.SCHOLARABLE_DOCUMENT_SCANNER) throw new Response("Document uploads unavailable", { status: 503 });
  if (!documentPilotAllowed(env, digest)) throw new Response("Private uploads are limited to pilot accounts", { status: 403 });
  const file = form.get("file");
  const category = String(form.get("category") || "");
  const review = reviewDate(form.get("review_on"));
  if (!(file instanceof File) || !file.size || file.size > DOCUMENT_MAX_BYTES || file.type !== "application/pdf" || !/\.pdf$/i.test(file.name)) throw new Response("Upload one PDF, up to 5 MB", { status: 400 });
  if (form.get("consent") !== "yes" || !documentCategories.includes(category as DocumentCategory) || file.name.length > 160 || /[\u0000-\u001f]/.test(file.name)) throw new Response("Choose a category and agree to storage", { status: 400 });
  const documentId = form.get("documentId") ? id(String(form.get("documentId"))) : crypto.randomUUID();
  const expected = form.get("documentId") ? Number(form.get("version")) : 0;
  if (!Number.isSafeInteger(expected) || expected < 0 || expected >= 2147483647 || (form.get("documentId") && expected === 0)) throw new Response("Invalid document version", { status: 400 });
  if (expected) {
    const current = (await readDocuments(query, digest)).find(document => document.id === documentId);
    if (!current) throw new Response("Document not found", { status: 404 });
    if (current.version !== expected) throw new Response("This document changed. Reload before trying again.", { status: 409 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Response("Invalid PDF", { status: 422 });
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => {
    controller.abort(); reject(new Response("Document safety check timed out", { status: 503 }));
  }, 15000); });
  try {
    // Scanner must parse every stream and reject encryption, active content, malware,
    // excessive expansion and unreadable files. No filename or student identity is sent.
    const verdict = await Promise.race([(async () => {
      const response = await env.SCHOLARABLE_DOCUMENT_SCANNER!.fetch(new Request("https://document-scanner/scan", {
        method: "POST", body: bytes, headers: { "Content-Type": "application/pdf" }, signal: controller.signal,
      }));
      const reader = response.body?.getReader();
      if (!response.ok || !reader) { await reader?.cancel(); return null; }
      const body = new Uint8Array(1024); let length = 0;
      try {
        while (true) { const part = await reader.read(); if (part.done) break;
          if (length + part.value.length > body.length) throw new Response("Invalid safety check response", { status: 422 });
          body.set(part.value, length); length += part.value.length;
        }
      } finally { await reader.cancel(); }
      return JSON.parse(new TextDecoder().decode(body.slice(0, length))) as Record<string, unknown>;
    })(), timeout]);
    if (verdict?.clean !== true || verdict?.readable !== true || verdict?.format !== "pdf") throw new Response("This PDF could not pass the safety check", { status: 422 });
  } finally { clearTimeout(timer); }
  const encrypted = await documentCipher(env, digest, documentId, expected + 1, bytes);
  await query("select save_student_document(decode($1, 'hex'), $2::uuid, $3, $4, $5::date, $6, $7, decode($8, 'hex'))",
    [digest, documentId, file.name, category, review || null, expected, file.size, hex(encrypted)]);
}

export async function downloadDocument(query: StudentDataQuery, digest: string, env: DocumentEnv, documentId: string, version: number): Promise<Response> {
  if (!documentsReady(env) || !Number.isSafeInteger(version) || version < 1) throw new Response("Document not found", { status: 404 });
  const rows = await query("select read_student_document_version(decode($1, 'hex'), $2::uuid, $3) as document", [digest, id(documentId), version]);
  const document = rows[0]?.document as { ciphertext: string } | undefined;
  if (!document) throw new Response("Document not found", { status: 404 });
  const bytes = await documentCipher(env, digest, documentId, version, unhex(document.ciphertext), true);
  return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="scholarable-document-v${version}.pdf"`,
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "sandbox" } });
}

export async function changeDocument(query: StudentDataQuery, digest: string, form: FormData): Promise<void> {
  const documentId = id(String(form.get("documentId") || ""));
  if (form.get("intent") === "delete") {
    if (form.get("confirm") !== "DELETE") throw new Response("Type DELETE to confirm", { status: 400 });
    await query("select delete_student_document(decode($1, 'hex'), $2::uuid)", [digest, documentId]);
  } else if (form.get("intent") === "link" || form.get("intent") === "unlink") {
    const callId = String(form.get("callId") || "");
    if (!/^[1-9][0-9]{0,17}$/.test(callId)) throw new Response("Invalid application", { status: 400 });
    await query("select link_student_document(decode($1, 'hex'), $2::uuid, $3::bigint, $4)", [digest, documentId, callId, form.get("intent") === "link"]);
  } else if (form.get("intent") === "renew") {
    const version = Number(form.get("version")); const review = reviewDate(form.get("review_on"));
    if (form.get("consent") !== "yes" || !Number.isSafeInteger(version) || version < 1) throw new Response("Confirm continued storage and choose a valid review date", { status: 400 });
    await query("select renew_student_document(decode($1, 'hex'), $2::uuid, $3, $4::date)", [digest, documentId, version, review || null]);
  } else throw new Response("Unknown document action", { status: 400 });
}
