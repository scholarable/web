import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { activityDetails, dateProblem, deadlineText, planningWindows, validDate } from "../lib/activity-planning";
import { publicDetails } from "../lib/public-details";
import { ActivityCheck } from "../components/activity-check";

const window = (id: string, extra = {}) => ({ id, track_id: "study", route_id: "portal", window_type: "application", deadline_on: "2027-01-10", deadline_precision: "date_only", ...extra });
const details = activityDetails({ tracks: [{ id: "study", label: "Study abroad" }, { id: "intern", label: "Internship" }], windows: [window("first"), window("second", { deadline_on: "2027-05-26" }), window("renewal", { window_type: "renewal" }), window("other", { track_id: "intern" }), window("missing", { route_id: "missing" })] });
const routes = [{ id: "portal", track_id: "study" }];

test("planning dates validate calendar and order, while allowing withheld answers", () => {
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(validDate("2027-02-29"), false);
  assert.equal(validDate("2027-04-31"), false);
  assert.equal(dateProblem("", ""), null);
  assert.equal(dateProblem("2027-01-01", ""), null);
  assert.ok(dateProblem("2027-03-01", "2027-02-01"));
  assert.equal(dateProblem("2027-03-01", "2027-03-01"), null);
});

test("only explicit track and route scope filters windows; both half-year deadlines remain", () => {
  assert.deepEqual(planningWindows(details, "study", routes).map(w => w.id), ["first", "second"]);
  assert.deepEqual(planningWindows(details, "", routes), []);
  assert.deepEqual(planningWindows(details, "invented", routes), []);
  assert.deepEqual(planningWindows(details, "intern", routes), []);
});

test("malformed scope is discarded, and legacy payloads remain usable", () => {
  assert.deepEqual(activityDetails({}), { tracks: [], windows: [] });
  assert.deepEqual(activityDetails({ windows: [window("bad", { track_id: 123 })] }).windows, []);
  assert.deepEqual(activityDetails({ windows: Array(501).fill(window("many")) }), { tracks: [], windows: [] });
  assert.equal(activityDetails({ windows: [window("bad-date", { deadline_on: "2027-02-30" })] }).windows[0].deadline_on, null);
});

test("deadline precision remains explicit instead of inventing a closing time", () => {
  const w = details.windows[0];
  assert.match(deadlineText(w), /Closing time is not confirmed/);
  assert.match(deadlineText({ ...w, deadline_precision: "estimated" }), /Estimated/);
  assert.match(deadlineText({ ...w, deadline_precision: "exact_time" }), /needs confirmation/);
  assert.match(deadlineText({ ...w, deadline_on: null }), /needs confirmation/);
  assert.match(deadlineText({ ...w, deadline_on: null, deadline_precision: "provider_defined" }), /depends on your country/);
});

test("server render disables answers before hydration and cannot submit answers into URLs", () => {
  const html = renderToStaticMarkup(createElement(ActivityCheck, { details: publicDetails({}) }));
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /<form|name=|action=/);
  assert.match(html, /gehen nicht an Scholarable/);
  assert.doesNotMatch(html, /role="status"/);
});
