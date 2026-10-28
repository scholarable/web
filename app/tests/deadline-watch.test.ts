import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { DeadlineWatch } from "../components/deadline-watch";
import { deadlineWatch, todayInBerlin } from "../lib/deadline-watch";
import { publicDetails } from "../lib/public-details";

test("watch shows current reviewed application dates, not estimated, past, or unbound scope", () => {
  const base = { id: "first", track_id: "track", route_id: "portal", window_type: "application", deadline_on: "2027-05-26", deadline_precision: "date_only" };
  const details = publicDetails({ tracks: [{ id: "track", label: "Exchange" }], routes: [{ id: "portal", label: "Online portal" }], windows: [
    base, { ...base, id: "past", deadline_on: "2027-05-20" }, { ...base, id: "estimated", deadline_precision: "estimated" },
    { ...base, id: "renewal", window_type: "renewal" }, { ...base, id: "missing-route", route_id: "gone" },
  ] });
  assert.deepEqual(deadlineWatch(details, "2027-05-25").map(item => item.id), ["first"]);
  assert.equal(deadlineWatch(details, "2027-05-25")[0].scope, "Exchange · Online portal");
  assert.equal(deadlineWatch(details, "2027-05-25")[0].daysAway, 1);
  assert.deepEqual(deadlineWatch(details, "not-a-date"), []);
  assert.equal(todayInBerlin(new Date("2026-09-20T22:30:00Z")), "2026-09-21");
});

test("watch explains its scope and never promises email notification", () => {
  const details = publicDetails({ windows: [{ id: "one", window_type: "application", deadline_on: "2027-05-26", deadline_precision: "date_only" }] });
  const [date] = deadlineWatch(details, "2027-05-16");
  assert.equal(date.timing, "Deadline: 26 May 2027. Closing time is not confirmed.", "reminder emails keep their wording");
  assert.equal(date.timingDe, "26. Mai 2027 · Uhrzeit nicht angegeben");
  assert.equal(date.scopeDe, "Allgemeine Bewerbungsfrist");
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(DeadlineWatch, { items: [{ callId: "1", title: "Sample", slug: "demo-bachelor", date }], sample: true })));
  assert.match(html, /Erfundene Daten/);
  assert.match(html, /keine E-Mail-Erinnerungen/);
  assert.match(html, /in 10 Tagen · in den nächsten 30 Tagen/);
  assert.match(html, /Uhrzeit nicht angegeben/);
});
