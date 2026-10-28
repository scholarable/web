import assert from "node:assert/strict";
import test from "node:test";
import { principalFromVerifiedSession, requireSameOriginPost, requireStudentAuth, studentAuthReady } from "../lib/student-auth.server";
import { loader as signInLoader } from "../routes/auth-sign-in";
import { loader as signUpLoader } from "../routes/auth-sign-up";
import { loader as discoveryLoader } from "../routes/match";
import { loader as downloadLoader } from "../routes/account-download";

const origin = "https://students.scholarable.test";
const request = (url = `${origin}/account`, method = "GET", postOrigin?: string) => new Request(url, {
  method, headers: postOrigin ? { Origin: postOrigin } : undefined,
});
const valid = {
  SCHOLARABLE_STUDENT_AUTH_ENABLED: "true",
  SCHOLARABLE_STUDENT_DATABASE_URL: "postgres://student-role@db.invalid/scholarable",
  SCHOLARABLE_STUDENT_IDENTITY_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  WORKOS_CLIENT_ID: "client_test",
  WORKOS_API_KEY: "sk_test",
  WORKOS_REDIRECT_URI: `${origin}/auth/callback`,
  WORKOS_COOKIE_PASSWORD: "a".repeat(32),
};

test("anonymous discovery remains available when accounts are enabled on a cold worker", async () => {
  const response = await discoveryLoader({ request: request(`${origin}/match`), context: { cloudflare: { env: valid } }, params: {}, url: new URL(`${origin}/match`), pattern: "/match" });
  const result = "data" in response ? response.data : response;
  assert.equal(result.studentAccounts, true);
  assert.deepEqual(result.initialFacts, {});
  assert.equal(result.adultConfirmed, false);
});

test("student sign-in remains dark until its complete configuration is present", () => {
  assert.equal(studentAuthReady(request(), undefined), false);
  assert.equal(studentAuthReady(request(), { ...valid, SCHOLARABLE_STUDENT_AUTH_ENABLED: "false" }), false);
  assert.equal(studentAuthReady(request(), { ...valid, WORKOS_API_KEY: undefined }), false);
  assert.equal(studentAuthReady(request(), { ...valid, SCHOLARABLE_STUDENT_IDENTITY_KEY: "short" }), false);
  assert.equal(studentAuthReady(request(), { ...valid, WORKOS_REDIRECT_URI: "https://evil.invalid/auth/callback" }), false);
  assert.equal(studentAuthReady(request("http://students.scholarable.test/account"), {
    ...valid, WORKOS_REDIRECT_URI: "http://students.scholarable.test/auth/callback",
  }), false);
  assert.equal(studentAuthReady(request(), valid), true);
  assert.throws(() => requireStudentAuth(request(), undefined), (error) => error instanceof Response && error.status === 404);
  assert.throws(() => requireStudentAuth(request(), { ...valid, WORKOS_API_KEY: undefined }), (error) => error instanceof Response && error.status === 503);
});

test("student mutations require a same-origin POST", () => {
  assert.throws(() => requireSameOriginPost(request()), (error) => error instanceof Response && error.status === 403);
  assert.throws(() => requireSameOriginPost(request(`${origin}/account`, "POST")), (error) => error instanceof Response && error.status === 403);
  assert.throws(() => requireSameOriginPost(request(`${origin}/account`, "POST", "https://evil.invalid")), (error) => error instanceof Response && error.status === 403);
  assert.doesNotThrow(() => requireSameOriginPost(request(`${origin}/account`, "POST", origin)));
  const localNavigation = (url: string, site: string) => new Request(url, { method: "POST", headers: {
    Origin: "null", "Sec-Fetch-Site": site, "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document",
  } });
  assert.doesNotThrow(() => requireSameOriginPost(localNavigation("http://127.0.0.1:5173/account", "same-origin")));
  assert.throws(() => requireSameOriginPost(localNavigation("http://127.0.0.1:5173/account", "cross-site")), (error) => error instanceof Response && error.status === 403);
  assert.throws(() => requireSameOriginPost(localNavigation(`${origin}/account`, "same-origin")), (error) => error instanceof Response && error.status === 403);
});

test("verified WorkOS claims must bind subject, client and non-impersonated session", () => {
  const token = (claims: object) => `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
  const claims = { iss: "https://api.workos.com", sub: "user_123", client_id: "client_test" };
  assert.deepEqual(principalFromVerifiedSession(token(claims), "user_123", "client_test"), { issuer: claims.iss, subject: claims.sub });
  for (const changed of [
    { ...claims, sub: "other" }, { ...claims, client_id: "other" },
    { ...claims, iss: "" }, { ...claims, act: { sub: "admin" } },
  ]) assert.throws(() => principalFromVerifiedSession(token(changed), "user_123", "client_test"),
    (error) => error instanceof Response && error.status === 403);
});

test("sign-in and sign-up render local forms without hosted redirects or secrets", async () => {
  for (const [loader, path, mode] of [[signInLoader, "sign-in", "sign-in"], [signUpLoader, "sign-up?save=42", "sign-up"]] as const) {
    const response = await loader({ request: request(`${origin}/auth/${path}`), context: { cloudflare: { env: valid } }, params: {}, url: new URL(`${origin}/auth/${path}`), pattern: "/auth/:mode" });
    assert.ok(!(response instanceof Response));
    assert.equal(response.data.mode, mode);
    assert.equal(response.data.step, "credentials");
    assert.equal(response.data.returnTo, mode === "sign-up" ? "/account?save=42" : "/account");
    assert.doesNotMatch(JSON.stringify(response.data), /sk_test|postgres|AAAA/);
    assert.equal(new Headers(response.init?.headers).get("Cache-Control"), "no-store");
  }
});

test("saved-plan download is unavailable in dark mode", async () => {
  const args = {
    request: request(`${origin}/account/download`), context: { cloudflare: { env: {} } },
  } as unknown as Parameters<typeof downloadLoader>[0];
  await assert.rejects(downloadLoader(args), (error) => error instanceof Response && error.status === 404);
});

test("saved-plan download redirects signed-out visitors to sign in", async () => {
  const args = {
    request: request(`${origin}/account/download`), context: { cloudflare: { env: valid } },
  } as unknown as Parameters<typeof downloadLoader>[0];
  await assert.rejects(downloadLoader(args), (error) => error instanceof Response && error.status === 302
    && error.headers.get("Location") === "/auth/sign-in?returnTo=%2Faccount%2Fdownload");
});
