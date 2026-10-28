import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { sampleCallId, sampleGuide, sampleTitle, sampleWritingFact } from "../lib/account-sample";
import { applicationWorkspace } from "../lib/application-workspace";
import { demoGuide } from "../lib/demo-catalogue.server";
import { publicDetails } from "../lib/public-details";
import {
  captureStudentApplicationSubmission, createStudentApplicationWorkspace,
  deleteStudentApplicationWorkspace, readStudentApplicationWorkspace,
  readStudentApplicationWorkspaces,
  refreshStudentApplicationWorkspace, setStudentApplicationScope, updateStudentApplicationDocument,
  updateStudentApplicationDraft, updateStudentApplicationNote, type StudentDataQuery,
} from "../lib/student-progress.server";
import ApplicationWorkspace from "../routes/application-workspace";

const digest = "11".repeat(32);
const packet = demoGuide("demo-bachelor")!;
const raw = {
  call_id: "42", packet_version: packet.packet_version, packet, current_packet: packet,
  packet_status: "current", deadline_status: "current", note: "Private note", version: 2,
  selected_track_id: null, selected_route_id: null,
  created_at: "2026-09-26T00:00:00Z", updated_at: "2026-09-26T00:01:00Z",
  drafts: [{ question_id: packet.questions[0].id, answer: "My answer", state: "drafting", version: 1, updated_at: "2026-09-26T00:01:00Z" }],
  archived_drafts: [],
  checklist: packet.documents.map(document => ({ document_id: document.id, state: "not_started", version: 0, updated_at: null })),
  archived_checklist: [],
  submissions: [],
};

test("workspace parser preserves explicit current, changed, and unavailable packet states", () => {
  assert.deepEqual(applicationWorkspace(raw), raw);
  const changed = { ...packet, packet_version: `${packet.packet_version}:new` };
  assert.ok(applicationWorkspace({ ...raw, current_packet: changed, packet_status: "changed" }));
  assert.ok(applicationWorkspace({ ...raw, current_packet: null, packet_status: "unavailable" }));
  assert.ok(applicationWorkspace({ ...raw, deadline_status: "expired" }));
  assert.ok(applicationWorkspace({ ...raw, deadline_status: "unknown" }));
  assert.equal(applicationWorkspace({ ...raw, deadline_status: "current_or_unknown" }), null);
  assert.equal(applicationWorkspace({ ...raw, packet_status: "current", current_packet: changed }), null);
  assert.equal(applicationWorkspace({ ...raw, selected_route_id: packet.routes[0].id }), null);
  assert.equal(applicationWorkspace({ ...raw, drafts: [{ ...raw.drafts[0], question_id: "unknown" }] }), null);
  assert.equal(applicationWorkspace({ ...raw, checklist: [{ document_id: "unknown", state: "ready", version: 1, updated_at: null }] }), null);
  assert.equal(applicationWorkspace({ ...raw, submissions: Array(101).fill({}) }), null);
});

test("workspace writes stay parameterized and carry optimistic versions", async () => {
  const calls: { text: string; values: unknown[] }[] = [];
  const query: StudentDataQuery = async (text, values) => {
    calls.push({ text, values });
    if (text.includes("read_student_application_workspaces")) return [{ workspaces: [raw] }];
    if (text.includes("read_student_application_workspace")) return [{ workspace: raw }];
    return [{ created: true, deleted: true, version: 3, snapshot_id: "81" }];
  };
  assert.equal(await createStudentApplicationWorkspace(query, digest, "42"), true);
  assert.deepEqual(await readStudentApplicationWorkspace(query, digest, "42"), raw);
  assert.deepEqual(await readStudentApplicationWorkspaces(query, digest), [raw]);
  assert.equal(await refreshStudentApplicationWorkspace(query, digest, "42", 2), 3);
  assert.equal(await setStudentApplicationScope(query, digest, "42", packet.routes[0].track_id, packet.routes[0].id, 2), 3);
  assert.equal(await updateStudentApplicationNote(query, digest, "42", "Notes", 2), 3);
  assert.equal(await updateStudentApplicationDraft(query, digest, "42", packet.questions[0].id, "Answer", "approved", 1), 3);
  assert.equal(await updateStudentApplicationDocument(query, digest, "42", packet.documents[0].id, "ready", 0), 3);
  assert.equal(await captureStudentApplicationSubmission(query, digest, "42"), "81");
  assert.equal(await deleteStudentApplicationWorkspace(query, digest, "42"), true);
  assert.equal(calls.length, 10);
  assert.ok(calls.every(call => call.text.includes("$1") && !call.text.includes(digest)));
  assert.equal(calls[6].values.at(-1), 1);
  assert.equal(calls[7].values.at(-1), 0);
});

test("workspace client rejects invalid identifiers, states, sizes, and versions before storage", async () => {
  const never: StudentDataQuery = async () => { assert.fail("storage must not run"); };
  await assert.rejects(createStudentApplicationWorkspace(never, digest, "0"));
  await assert.rejects(setStudentApplicationScope(never, digest, "42", null, "", 1));
  await assert.rejects(updateStudentApplicationNote(never, digest, "42", "x".repeat(20001), 1));
  await assert.rejects(updateStudentApplicationDraft(never, digest, "42", "", "Answer", "approved", 0));
  await assert.rejects(updateStudentApplicationDraft(never, digest, "42", "question", "Answer", "invalid" as never, 0));
  await assert.rejects(updateStudentApplicationDocument(never, digest, "42", "document", "ready", -1));
  await assert.rejects(refreshStudentApplicationWorkspace(never, digest, "42", 0));
});

test("private fictional workspace exposes saving but no verified or submission claim", () => {
  const workspace = { ...raw, call_id: sampleCallId, packet_version: sampleGuide.packet_version,
    packet: sampleGuide, current_packet: sampleGuide, selected_route_id: null,
    drafts: [], checklist: sampleGuide.documents.map(document => ({ document_id: document.id,
      state: "not_started", version: 0, updated_at: null })) };
  const router = createMemoryRouter([{ id: "workspace", path: `/account/applications/${sampleCallId}`,
    Component: ApplicationWorkspace, action: async () => ({}) }], {
    initialEntries: [`/account/applications/${sampleCallId}`],
    hydrationData: { loaderData: { workspace: { workspace, scholarship: { title: sampleTitle, slug: "", details: publicDetails({}) },
      eligibility: [], createPacket: null, application: null, outcome: null, library: [], linkedDocuments: [],
      vault: { items: [sampleWritingFact] }, writingEnabled: true, testOnly: true } } },
  });
  const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
  assert.match(html, /Nur privater Test/);
  assert.match(html, /Erfundene Übungsfassung/);
  assert.match(html, /Antwort speichern/);
  assert.match(html, /KI-Schreibhilfe/);
  assert.doesNotMatch(html, /Aktuelles, geprüftes Stipendium|Einreichung festhalten/);
  assert.doesNotMatch(html, /Private Kopien deiner Dokumente/);
});
