import assert from "node:assert/strict";
import test from "node:test";
import { CV_EXTRACTION_MODEL, CV_VERIFICATION_MODEL, cvImportResponse, extractCvCandidates, type CvDocumentConverter } from "../lib/cv-import.server";

const pdf = (content = "synthetic") => new File(
  [new TextEncoder().encode(`%PDF-1.7\n${content}\n%%EOF`)], "resume.pdf", { type: "application/pdf" },
);
const docx = () => new File(
  [new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "[Content_Types].xml word/document.xml"], "resume.docx",
  { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
);

function request(file: File, origin = "https://scholarable.test") {
  const body = new FormData(); body.set("cv", file);
  return new Request("https://scholarable.test/api/cv-import", { method: "POST", headers: { Origin: origin }, body });
}

function converter(
  data = "Learning\nMSc Computational Linguistics at Example University\nTools\nElixir",
  output: unknown = { candidates: [
    { kind: "education", evidence: "MSc Computational Linguistics at Example University", line: 2 },
    { kind: "skill", evidence: "Elixir", line: 4 },
  ] },
  tokens = 20,
  verification?: unknown,
) {
  let calls = 0;
  const proposed = output && typeof output === "object" && Array.isArray((output as { candidates?: unknown }).candidates)
    ? (output as { candidates: unknown[] }).candidates
    : [];
  const defaultVerification = {
    verdicts: proposed.map((_candidate, index) => ({ id: `cv-${index + 1}`, allowed: true })),
  };
  const binding: CvDocumentConverter = {
    async toMarkdown() { return { format: "text", tokens, data }; },
    async run() { return { response: calls++ === 0 ? output : verification ?? defaultVerification }; },
  };
  return binding;
}

test("CV import validates, converts and returns grounded candidates from unfamiliar wording", async () => {
  const response = await cvImportResponse(request(pdf()), { AI: converter(), SCHOLARABLE_CV_IMPORT_ENABLED: "true" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { candidates: [
    { id: "cv-1", kind: "education", value: "MSc Computational Linguistics at Example University", source: "line 2" },
    { id: "cv-2", kind: "skill", value: "Elixir", source: "line 4" },
  ] });
});

test("DOCX-shaped files reach structural conversion without permitting macro content", async () => {
  assert.equal((await cvImportResponse(request(docx()), { AI: converter(), SCHOLARABLE_CV_IMPORT_ENABLED: "true" })).status, 200);
  const macro = new File(
    [new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "[Content_Types].xml word/document.xml vbaProject.bin"], "resume.docx",
    { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  );
  assert.equal((await cvImportResponse(request(macro), { AI: converter(), SCHOLARABLE_CV_IMPORT_ENABLED: "true" })).status, 422);
});

test("schema proposals accept unseen facts and copy only exact evidence", () => {
  const document = [
    "Selected practice", "Chaos wrangler at Moonbase Labs", "Things I made", "Invented a zephyr compiler for community radio",
    "Werkzeuge", "Gleam", "Idiomas", "Galician",
  ].join("\n");
  assert.deepEqual(extractCvCandidates(document, { candidates: [
    { kind: "experience", evidence: "Chaos wrangler at Moonbase Labs", line: 2 },
    { kind: "project", evidence: "Invented a zephyr compiler for community radio", line: 4 },
    { kind: "skill", evidence: "Gleam", line: 6 },
    { kind: "language", evidence: "Galician", line: 8 },
  ] }), [
    { id: "cv-1", kind: "experience", value: "Chaos wrangler at Moonbase Labs", source: "line 2" },
    { id: "cv-2", kind: "project", value: "Invented a zephyr compiler for community radio", source: "line 4" },
    { id: "cv-3", kind: "skill", value: "Gleam", source: "line 6" },
    { id: "cv-4", kind: "language", value: "Galician", source: "line 8" },
  ]);
});

test("exact evidence preserves source whitespace", () => {
  assert.deepEqual(extractCvCandidates("Projects\nBuilt\t\ta compiler", { candidates: [
    { kind: "project", evidence: "Built\t\ta compiler", line: 2 },
  ] }), [
    { id: "cv-1", kind: "project", value: "Built\t\ta compiler", source: "line 2" },
  ]);
});

test("high-precision privacy filtering keeps unfamiliar legitimate facts", () => {
  const document = [
    "MSc Political Science", "Health Policy Analyst", "Diplôme en santé publique",
    "Reduced deployment time via 3 automation tools",
  ].join("\n");
  assert.deepEqual(extractCvCandidates(document, { candidates: [
    { kind: "education", evidence: "MSc Political Science", line: 1 },
    { kind: "experience", evidence: "Health Policy Analyst", line: 2 },
    { kind: "education", evidence: "Diplôme en santé publique", line: 3 },
    { kind: "experience", evidence: "Reduced deployment time via 3 automation tools", line: 4 },
  ] })?.map(candidate => candidate.value), [
    "MSc Political Science", "Health Policy Analyst", "Diplôme en santé publique",
    "Reduced deployment time via 3 automation tools",
  ]);
});

test("grounding, schema, sensitive-data and category limits fail closed", () => {
  const document = ["TypeScript; Muslim", "me@example.com", "Refugee status", "Alpha", "Beta", "Gamma", "Delta", "Epsilon"].join("\n");
  assert.deepEqual(extractCvCandidates(document, { candidates: [
    { kind: "skill", evidence: "TypeScript", line: 1 },
    { kind: "skill", evidence: "Muslim", line: 1 },
    { kind: "experience", evidence: "me@example.com", line: 2 },
    { kind: "award", evidence: "Refugee status", line: 3 },
    { kind: "skill", evidence: "Alpha", line: 4 },
    { kind: "skill", evidence: "Beta", line: 5 },
    { kind: "skill", evidence: "Gamma", line: 6 },
    { kind: "skill", evidence: "Delta", line: 7 },
    { kind: "skill", evidence: "Epsilon", line: 8 },
  ] }), [
    { id: "cv-1", kind: "skill", value: "TypeScript", source: "line 1" },
    { id: "cv-2", kind: "skill", value: "Alpha", source: "line 4" },
    { id: "cv-3", kind: "skill", value: "Beta", source: "line 5" },
    { id: "cv-4", kind: "skill", value: "Gamma", source: "line 6" },
  ]);
  assert.equal(extractCvCandidates(document, { candidates: [{ kind: "skill", evidence: "Rust", line: 1 }] }), null);
  assert.equal(extractCvCandidates(document, { candidates: [{ kind: "identity", evidence: "TypeScript", line: 1 }] }), null);
  assert.equal(extractCvCandidates(document, { candidates: Array.from({ length: 13 }, () => ({ kind: "skill", evidence: "TypeScript", line: 1 })) }), null);
  assert.equal(extractCvCandidates(document, "not json"), null);
});

test("model request is bounded, schema-constrained and treats CV text as untrusted", async () => {
  const models: string[] = []; const inputs: Record<string, unknown>[] = [];
  const binding = converter();
  let calls = 0;
  binding.run = async (selected, body) => {
    models.push(selected); inputs.push(body as Record<string, unknown>);
    return { response: calls++ === 0
      ? { candidates: [{ kind: "skill", evidence: "Elixir", line: 4 }] }
      : { verdicts: [{ id: "cv-1", allowed: true }] } };
  };
  const response = await cvImportResponse(request(pdf()), { AI: binding, SCHOLARABLE_CV_IMPORT_ENABLED: "true" });
  assert.equal(response.status, 200);
  assert.deepEqual(models, [CV_EXTRACTION_MODEL, CV_VERIFICATION_MODEL]);
  assert.deepEqual(inputs.map(input => input.max_tokens), [1_000, 500]);
  for (const input of inputs) {
    assert.equal((input.response_format as { type?: string }).type, "json_schema");
    assert.match(JSON.stringify(input.messages), /untrusted document text/);
  }
});

test("deterministic privacy gate rejects sensitive facts even when model output approves them", async () => {
  const data = ["Calle Mayor 12, Madrid", "Religión: musulmán", "Catholic", "Statut: réfugié", "Lives in Berlin"].join("\n");
  const proposed = { candidates: [
    { kind: "experience", evidence: "Calle Mayor 12, Madrid", line: 1 },
    { kind: "language", evidence: "Religión: musulmán", line: 2 },
    { kind: "language", evidence: "Catholic", line: 3 },
    { kind: "award", evidence: "Statut: réfugié", line: 4 },
    { kind: "skill", evidence: "Lives in Berlin", line: 5 },
  ] };
  const verification = { verdicts: proposed.candidates.map((_candidate, index) => ({ id: `cv-${index + 1}`, allowed: true })) };
  const response = await cvImportResponse(request(pdf()), {
    AI: converter(data, proposed, 20, verification), SCHOLARABLE_CV_IMPORT_ENABLED: "true",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { candidates: [] });
});

test("independent verifier rejects an exact but misclassified excerpt", async () => {
  const response = await cvImportResponse(request(pdf()), {
    AI: converter(
      "Profile\nEnjoys hiking",
      { candidates: [{ kind: "skill", evidence: "Enjoys hiking", line: 2 }] },
      20,
      { verdicts: [{ id: "cv-1", allowed: false }] },
    ),
    SCHOLARABLE_CV_IMPORT_ENABLED: "true",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { candidates: [] });
});

test("malformed, missing and duplicate verification verdicts fail closed", async () => {
  const data = "Tools\nRust";
  const proposed = { candidates: [{ kind: "skill", evidence: "Rust", line: 2 }] };
  for (const verification of [
    { verdicts: [] },
    { verdicts: [{ id: "cv-1", allowed: true }, { id: "cv-1", allowed: false }] },
    { verdicts: [{ id: "wrong-id", allowed: true }] },
    "not json",
  ]) {
    const response = await cvImportResponse(request(pdf()), {
      AI: converter(data, proposed, 20, verification), SCHOLARABLE_CV_IMPORT_ENABLED: "true",
    });
    assert.equal(response.status, 422);
  }
});

test("excessive physical line count fails before model inference", async () => {
  let inferenceCalls = 0;
  const binding = converter(Array.from({ length: 251 }, (_value, index) => `Line ${index + 1}`).join("\n"));
  binding.run = async () => { inferenceCalls += 1; return { response: { candidates: [] } }; };
  const response = await cvImportResponse(request(pdf()), { AI: binding, SCHOLARABLE_CV_IMPORT_ENABLED: "true" });
  assert.equal(response.status, 413);
  assert.equal(inferenceCalls, 0);
});

test("conservative combined prompt budget fails closed", async () => {
  let inferenceCalls = 0;
  const longLines = Array.from({ length: 12 }, (_value, index) => `${String(index).padStart(2, "0")}${"A".repeat(238)}`);
  const data = [...longLines, ...Array.from({ length: 238 }, (_value, index) => `${index}${"B".repeat(66)}`)].join("\n");
  const proposed = { candidates: longLines.map((evidence, index) => ({
    kind: (["education", "experience", "project"] as const)[Math.floor(index / 4)], evidence, line: index + 1,
  })) };
  const binding = converter(data, proposed, 4_000);
  binding.run = async () => { inferenceCalls += 1; return { response: proposed }; };
  const response = await cvImportResponse(request(pdf()), { AI: binding, SCHOLARABLE_CV_IMPORT_ENABLED: "true" });
  assert.equal(response.status, 413);
  assert.ok(inferenceCalls <= 1);
});

test("CV import fails closed before conversion for disabled, cross-origin and unsafe files", async () => {
  let called = false;
  const binding: CvDocumentConverter = {
    async toMarkdown() { called = true; throw new Error("must not run"); },
    async run() { called = true; throw new Error("must not run"); },
  };
  assert.equal((await cvImportResponse(request(pdf()), { AI: binding })).status, 503);
  assert.equal((await cvImportResponse(request(pdf(), "https://attacker.test"), { AI: binding, SCHOLARABLE_CV_IMPORT_ENABLED: "true" })).status, 403);
  assert.equal((await cvImportResponse(request(new File(["hello"], "resume.txt", { type: "text/plain" })), { AI: binding, SCHOLARABLE_CV_IMPORT_ENABLED: "true" })).status, 415);
  assert.equal((await cvImportResponse(request(pdf("/JavaScript malicious")), { AI: binding, SCHOLARABLE_CV_IMPORT_ENABLED: "true" })).status, 422);
  assert.equal((await cvImportResponse(request(pdf("/Java#53cript escaped")), { AI: binding, SCHOLARABLE_CV_IMPORT_ENABLED: "true" })).status, 422);
  assert.equal(called, false);
});

test("unreadable, failed, malformed and oversized processing returns generic errors", async () => {
  assert.equal((await cvImportResponse(request(pdf()), { AI: converter("private cv content", { candidates: [] }, 4001), SCHOLARABLE_CV_IMPORT_ENABLED: "true" })).status, 413);
  assert.equal((await cvImportResponse(request(pdf()), { AI: converter("private cv content", { candidates: [] }, -1), SCHOLARABLE_CV_IMPORT_ENABLED: "true" })).status, 413);
  const broken: CvDocumentConverter = {
    async toMarkdown() { throw new Error("provider secret failure"); },
    async run() { throw new Error("provider secret failure"); },
  };
  const failed = await cvImportResponse(request(pdf()), { AI: broken, SCHOLARABLE_CV_IMPORT_ENABLED: "true" });
  assert.equal(failed.status, 422);
  assert.equal((await failed.text()).includes("provider secret"), false);
  assert.equal((await cvImportResponse(request(docx()), { AI: broken, SCHOLARABLE_CV_IMPORT_ENABLED: "true" })).status, 422);
  const inferenceFailure = converter(); inferenceFailure.run = async () => { throw new Error("private inference failure"); };
  assert.equal((await cvImportResponse(request(pdf()), { AI: inferenceFailure, SCHOLARABLE_CV_IMPORT_ENABLED: "true" })).status, 422);
  assert.equal((await cvImportResponse(request(pdf()), { AI: converter("Skills\nRust", { candidates: [{ kind: "skill", evidence: "Python", line: 2 }] }), SCHOLARABLE_CV_IMPORT_ENABLED: "true" })).status, 422);
});

test("separate imports have request-local results and no shared access key", async () => {
  const firstBody = await (await cvImportResponse(request(pdf()), { AI: converter("Tools\nRust", { candidates: [{ kind: "skill", evidence: "Rust", line: 2 }] }), SCHOLARABLE_CV_IMPORT_ENABLED: "true" })).text();
  const secondBody = await (await cvImportResponse(request(pdf()), { AI: converter("Spoken\nFrench", { candidates: [{ kind: "language", evidence: "French", line: 2 }] }), SCHOLARABLE_CV_IMPORT_ENABLED: "true" })).text();
  assert.match(firstBody, /Rust/); assert.doesNotMatch(firstBody, /French/);
  assert.match(secondBody, /French/); assert.doesNotMatch(secondBody, /Rust/);
  assert.doesNotMatch(firstBody + secondBody, /filename|resume\.pdf|session|account/i);
});

test("CV-derived values are not emitted to console or telemetry sinks", async () => {
  const captured: unknown[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...values) => { captured.push(...values); };
  console.warn = (...values) => { captured.push(...values); };
  console.error = (...values) => { captured.push(...values); };
  try {
    const binding = converter("Tools\nPrivateSyntheticSkill", { candidates: [{ kind: "skill", evidence: "PrivateSyntheticSkill", line: 2 }] });
    const response = await cvImportResponse(request(pdf()), { AI: binding, SCHOLARABLE_CV_IMPORT_ENABLED: "true" });
    assert.equal(response.status, 200);
  } finally {
    console.log = original.log; console.warn = original.warn; console.error = original.error;
  }
  assert.deepEqual(captured, []);
});
