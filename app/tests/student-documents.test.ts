import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import DocumentLibrary from "../routes/document-library";
import { boundedDocumentForm, changeDocument, cleanupDocuments, documentCipher, downloadDocument, saveDocument, type DocumentEnv } from "../lib/student-documents.server";
import type { StudentDataQuery } from "../lib/student-progress.server";

const digest = "ab".repeat(32);
const documentId = "12345678-1234-1234-1234-123456789012";
const bytes = new TextEncoder().encode("%PDF-1.7 test document");
const env: DocumentEnv = { SCHOLARABLE_DOCUMENTS_ENABLED: "true", SCHOLARABLE_DOCUMENT_CLEANUP_ENABLED: "true", SCHOLARABLE_DOCUMENT_KEY: "12".repeat(32),
  SCHOLARABLE_EMAIL_DATABASE_URL: "postgres://maintenance.invalid/scholarable", SCHOLARABLE_DOCUMENT_PILOT_DIGESTS: digest,
  SCHOLARABLE_DOCUMENT_SCANNER: { fetch: async () => Response.json({ clean: true, readable: true, format: "pdf" }) } };
function form() {
  const result = new FormData();
  result.set("file", new File([bytes], "cv.pdf", { type: "application/pdf" }));
  result.set("category", "cv"); result.set("consent", "yes"); return result;
}
const status = (expected: number) => (error: unknown) => error instanceof Response && error.status === expected;

test("ciphertext is authenticated to account, file and version; downloads stay private", async () => {
  const encrypted = await documentCipher(env, digest, documentId, 1, bytes);
  assert.equal(encrypted.length, bytes.length + 28);
  assert.deepEqual(await documentCipher(env, digest, documentId, 1, encrypted, true), bytes);
  await assert.rejects(documentCipher(env, "cd".repeat(32), documentId, 1, encrypted, true));
  await assert.rejects(documentCipher(env, digest, documentId, 2, encrypted, true));
  encrypted[15] ^= 1;
  await assert.rejects(documentCipher(env, digest, documentId, 1, encrypted, true));
  encrypted[15] ^= 1;
  const query: StudentDataQuery = async (_, values) => {
    assert.deepEqual(values, [digest, documentId, 1]);
    return [{ document: { ciphertext: Buffer.from(encrypted).toString("hex") } }];
  };
  const response = await downloadDocument(query, digest, env, documentId, 1);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Disposition")!, /^attachment/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  await assert.rejects(downloadDocument(async () => [{ document: null }], digest, env, documentId, 1), status(404));
  await assert.rejects(downloadDocument(async () => { throw new Error("queried while disabled"); }, digest, { ...env, SCHOLARABLE_DOCUMENTS_ENABLED: "false" }, documentId, 1), status(404));
});

test("uploads fail closed and store only ciphertext after explicit consent and scanner approval", async () => {
  let stored = 0;
  const query: StudentDataQuery = async (_, values) => {
    stored++;
    assert.equal(values[0], digest);
    assert.equal(values[6], bytes.length);
    assert.equal(Buffer.from(String(values[7]), "hex").length, bytes.length + 28);
    assert.ok(!String(values[7]).includes(Buffer.from(bytes).toString("hex")));
    return [];
  };
  await saveDocument(query, digest, env, form()); assert.equal(stored, 1);
  for (const pilot of [undefined, "", "cd".repeat(32), Array(11).fill(digest).join(","), digest + ",bad"]) {
    await assert.rejects(saveDocument(query, digest, { ...env, SCHOLARABLE_DOCUMENT_PILOT_DIGESTS: pilot }, form()), status(403));
  }
  assert.equal(stored, 1);
  const noConsent = form(); noConsent.delete("consent");
  await assert.rejects(saveDocument(query, digest, env, noConsent), status(400));
  const invalidDate = form(); invalidDate.set("review_on", "2026-99-99");
  await assert.rejects(saveDocument(query, digest, env, invalidDate), status(400));
  await assert.rejects(saveDocument(query, digest, { ...env, SCHOLARABLE_DOCUMENT_SCANNER: undefined }, form()), status(503));
  await assert.rejects(saveDocument(query, digest, { ...env, SCHOLARABLE_EMAIL_DATABASE_URL: undefined }, form()), status(503));
  for (const verdict of [{ clean: false, readable: true, format: "pdf" }, { clean: true, readable: false, format: "pdf" }, {}]) {
    await assert.rejects(saveDocument(query, digest, { ...env, SCHOLARABLE_DOCUMENT_SCANNER: { fetch: async () => Response.json(verdict) } }, form()), status(422));
  }
  await assert.rejects(saveDocument(query, digest, { ...env, SCHOLARABLE_DOCUMENT_SCANNER: { fetch: async () => new Response(" ".repeat(1025)) } }, form()), status(422));
  const replace = form(); replace.set("documentId", documentId); replace.set("version", "1");
  await assert.rejects(saveDocument(async () => [{ documents: [] }], digest, env, replace), status(404));
  await assert.rejects(saveDocument(async () => [{ documents: [{ id: documentId, version: 2 }] }], digest, env, replace), status(409));
  assert.equal(stored, 1);
});

test("multipart body is bounded without trusting Content-Length and oversized streams are cancelled", async () => {
  const upload = new Request("https://scholarable.test/account/documents", { method: "POST", body: form() });
  assert.equal((await boundedDocumentForm(upload)).get("category"), "cv");
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(6 * 1024 * 1024)); }, cancel() { cancelled = true; } });
  const oversized = new Request("https://scholarable.test/account/documents", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=test", "Content-Length": "1" }, body, duplex: "half" } as RequestInit);
  await assert.rejects(boundedDocumentForm(oversized), status(413));
  assert.ok(cancelled);
});

test("renewal needs explicit consent; scheduled cleanup remains independent of uploads", async () => {
  const renewal = new FormData(); renewal.set("intent", "renew"); renewal.set("documentId", documentId); renewal.set("version", "3");
  const calls: unknown[][] = [];
  const query: StudentDataQuery = async (_, values) => { calls.push(values); return []; };
  await assert.rejects(changeDocument(query, digest, renewal), status(400));
  assert.equal(calls.length, 0);
  renewal.set("consent", "yes"); await changeDocument(query, digest, renewal);
  assert.deepEqual(calls, [[digest, documentId, 3, null]]);
  let cleanups = 0;
  await cleanupDocuments({ ...env, SCHOLARABLE_DOCUMENTS_ENABLED: "false", SCHOLARABLE_EMAIL_DATABASE_URL: "postgres://unused" }, async () => async (sql, values) => {
    assert.equal(sql, "select cleanup_student_documents()"); assert.deepEqual(values, []); cleanups++; return [];
  });
  assert.equal(cleanups, 1);
  await assert.rejects(cleanupDocuments({ ...env, SCHOLARABLE_EMAIL_DATABASE_URL: undefined }), /cleanup database unavailable/);
});

test("library explains retention and lists only surviving versions after cleanup", () => {
  const router = createMemoryRouter([{ id: "documents", path: "/account/documents", Component: DocumentLibrary, action: async () => ({}) }], {
    initialEntries: ["/account/documents"], hydrationData: { loaderData: { documents: {
      enabled: true, canUpload: true, categories: ["cv"], applications: [], documents: [{ id: documentId, name: "cv.pdf", category: "cv", version: 5, latest_version: 3, size: 20,
        review_on: "2026-09-01", review_due: true, links: [], versions: [{ version: 3, review_on: "2026-09-01", replaced_at: null, review_due: true }] }],
    } } },
  });
  const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
  assert.match(html, /24 Monaten/); assert.match(html, /30 Tagen/); assert.match(html, /Weitere Speicherung von Version 3 bestätigen/);
  assert.match(html, /download\/3/); assert.doesNotMatch(html, /download\/(1|2|4|5)/);
});


test("deployment schedules daily document maintenance", () => {
  const config = JSON.parse(readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.triggers.crons, ["0 8 * * *"]);
});
