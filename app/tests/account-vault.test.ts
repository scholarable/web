import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import test from "node:test";
import Account from "../routes/account";

test("the plan page directs profile work to the dedicated guided route", () => {
  const router = createMemoryRouter([{ id: "account", path: "/account", Component: Account, action: async () => ({}) }], {
    initialEntries: ["/account"],
    hydrationData: { loaderData: { account: {
      user: { email: "student@example.test" },
      progress: { profile: null, opportunities: [], applications: [], outcomes: [], email_reminders_enabled: false, recommendation_emails_enabled: false },
      calls: [], candidate: null, remindersAvailable: false,
    } } },
  });
  const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
  assert.match(html, /href="\/profile"/);
  assert.match(html, /Profil öffnen/);
  assert.doesNotMatch(html, /name="intent" value="vault-create"/);
});

test("opt-out controls remain available while email delivery is paused", () => {
  const router = createMemoryRouter([{ id: "account", path: "/account", Component: Account, action: async () => ({}) }], {
    initialEntries: ["/account"],
    hydrationData: { loaderData: { account: {
      user: { email: "student@example.test" },
      progress: { profile: null, opportunities: [], applications: [], outcomes: [], email_reminders_enabled: true, recommendation_emails_enabled: true },
      calls: [], candidate: null, remindersAvailable: false, recommendationEmailsAvailable: false,
    } } },
  });
  const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
  assert.match(html, /E-Mails ausschalten/);
  assert.match(html, /Erinnerungen ausschalten/);
  assert.match(html, /Der Versand ist pausiert/);
});
