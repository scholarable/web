import assert from "node:assert/strict";
import test from "node:test";
import { interpretGoal, mergeDiscoveryFacts } from "../lib/discovery";

const options = { institution: ["Example University"], subject: ["computer_science", "engineering"], usesStudyPlan: true };

test("interprets only supported study facts from a conversational goal", () => {
  assert.deepEqual(interpretGoal("I study computer science at Example University, bachelor semester 3, and want to study abroad", options), {
    facts: { institution: "Example University", degree_level: "bachelor", subject: "computer_science", semester_number: "3", future_plan: "exchange" },
    searchIntent: { location: "", exclusions: "" },
    understood: ["Institution: Example University", "Study level: bachelor", "Subject: computer science", "Current semester: 3", "Near-term study plan: exchange"],
    clarification: null,
  });
});

test("unsupported or ambiguous requests produce one honest clarification and no guessed facts", () => {
  const result = interpretGoal("I need funding somewhere warm and flexible", options);
  assert.deepEqual(result.facts, {});
  assert.equal(result.understood.length, 0);
  assert.match(result.clarification || "", /could not map/i);
});

test("catalogue options and study-plan rules bound interpretation", () => {
  const result = interpretGoal("Doctoral engineering exchange, semester 21, at Another University", { ...options, usesStudyPlan: false });
  assert.deepEqual(result.facts, { degree_level: "doctoral", subject: "engineering" });
});

test("short option names do not match inside unrelated words", () => {
  assert.deepEqual(interpretGoal("I am starting soon", { ...options, subject: ["art"] }).facts, {});
});

test("conflicting supported values stay unset and produce one focused clarification", () => {
  const subjects = interpretGoal("computer science or engineering", options);
  assert.equal(subjects.facts.subject, undefined);
  assert.match(subjects.clarification || "", /one subject/i);
  const degrees = interpretGoal("I am deciding between a masters and a PhD", options);
  assert.equal(degrees.facts.degree_level, undefined);
  assert.match(degrees.clarification || "", /one study level/i);
  const institutions = interpretGoal("Example University or Other University", { ...options, institution: ["Example University", "Other University"] });
  assert.equal(institutions.facts.institution, undefined);
  assert.match(institutions.clarification || "", /one institution/i);
  const plans = interpretGoal("exchange or internship", options);
  assert.equal(plans.facts.future_plan, undefined);
  assert.match(plans.clarification || "", /one near-term study plan/i);
  const overlapping = interpretGoal("computer science", { ...options, subject: ["science", "computer_science"] });
  assert.equal(overlapping.facts.subject, undefined);
  assert.match(overlapping.clarification || "", /one subject/i);
  const semesters = interpretGoal("semester 3 or semester 4", options);
  assert.equal(semesters.facts.semester_number, undefined);
  assert.match(semesters.clarification || "", /one current semester/i);
  const mixedSemesters = interpretGoal("semester 21 or semester 3", options);
  assert.equal(mixedSemesters.facts.semester_number, undefined);
  assert.match(mixedSemesters.clarification || "", /one current semester/i);
  const invalidSemester = interpretGoal("bachelor student in semester 21", options);
  assert.equal(invalidSemester.facts.semester_number, undefined);
  assert.match(invalidSemester.clarification || "", /1 to 20/i);
});

test("bounded location and exclusion wording becomes correctable search intent, not eligibility facts", () => {
  const result = interpretGoal("I want scholarships in Germany but not large cities", options);
  assert.deepEqual(result.searchIntent, { location: "Germany", exclusions: "large cities" });
  assert.deepEqual(result.facts, {});
});

test("adding a source fills blank answers, preserves known and withheld answers, and exposes conflicts", () => {
  assert.deepEqual(mergeDiscoveryFacts({ institution: "Example University", subject: "prefer_not_to_say", degree_level: "" },
    { institution: "Other University", subject: "engineering", degree_level: "master" }), {
    facts: { institution: "Example University", subject: "prefer_not_to_say", degree_level: "master" }, conflicts: ["institution", "subject"],
  });
});
