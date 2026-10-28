import assert from "node:assert/strict";
import test from "node:test";
import { getWorkOS } from "@workos-inc/authkit-react-router";
import { action, loader, authReturnTo, pendingCookie, readPending } from "../lib/custom-auth.server";
import { requireStudentAuth } from "../lib/student-auth.server";

const origin = "https://students.scholarable.test";
const env = { SCHOLARABLE_STUDENT_AUTH_ENABLED: "true", SCHOLARABLE_STUDENT_DATABASE_URL: "postgres://student-role@db.invalid/scholarable", SCHOLARABLE_STUDENT_IDENTITY_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", WORKOS_CLIENT_ID: "client_test", WORKOS_API_KEY: "sk_test", WORKOS_REDIRECT_URI: `${origin}/auth/callback`, WORKOS_COOKIE_PASSWORD: "a".repeat(32) };
const args = (path: string, fields?: Record<string, string>, cookie?: string, postOrigin = origin) => ({ request: new Request(`${origin}${path}`, { method: fields ? "POST" : "GET", headers: { ...(fields ? { Origin: postOrigin, "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: fields ? new URLSearchParams(fields) : undefined }), context: { cloudflare: { env } }, params: {}, url: new URL(`${origin}${path}`), pattern: path });
const cookiePair = (value: string) => value.split(";")[0];
const authResponse = { user: { id: "user_test", email: "student@example.com", emailVerified: true }, accessToken: "access-secret", refreshToken: "refresh-secret" };

// First success intentionally runs before any protected route initializes SDK storage.
test("custom login creates the existing encrypted, seven-day session on a cold worker", async (t) => {
  requireStudentAuth(args("/auth/sign-in").request, env);
  const authenticate = t.mock.method(getWorkOS().userManagement, "authenticateWithPassword", async () => authResponse);
  const response = await action(args("/auth/sign-in?returnTo=%2Fprofile", { intent: "sign-in", email: "student@example.com", password: "correct-password" }));
  assert.ok(response instanceof Response);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/profile");
  assert.equal(authenticate.mock.calls[0].arguments[0]!.clientId, "client_test");
  const cookies = response.headers.get("Set-Cookie") || "";
  assert.match(cookies, /scholarable-session=.*Max-Age=604800.*HttpOnly.*Secure.*SameSite=Lax/);
  assert.doesNotMatch(cookies, /access-secret|refresh-secret|correct-password/);
});

test("verification secrets stay in a browser-bound encrypted cookie and valid codes finish signup", async (t) => {
  const users = getWorkOS().userManagement;
  t.mock.method(users, "createUser", async () => authResponse.user);
  t.mock.method(users, "authenticateWithPassword", async () => { throw { status: 400, rawData: { code: "email_verification_required", pending_authentication_token: "pending-secret", email: "student@example.com" } }; });
  const response = await action(args("/auth/sign-up?save=42", { intent: "sign-up", email: "student@example.com", password: "strong-password" }));
  assert.ok(!(response instanceof Response));
  assert.equal(response.data.step, "verify");
  assert.doesNotMatch(JSON.stringify(response.data), /pending-secret|strong-password/);
  const cookie = new Headers(response.init?.headers).get("Set-Cookie")!;
  assert.doesNotMatch(cookie, /pending-secret|student@example.com/);
  const pendingRequest = args("/auth/sign-up?save=42", undefined, cookiePair(cookie)).request;
  assert.equal((await readPending(pendingRequest, env.WORKOS_COOKIE_PASSWORD))?.token, "pending-secret");
  assert.equal(await readPending(pendingRequest, "wrong-key"), null);
  const verify = t.mock.method(users, "authenticateWithEmailVerification", async () => authResponse);
  const completed = await action(args("/auth/sign-up?save=42", { intent: "verify", code: "123456" }, cookiePair(cookie)));
  assert.ok(completed instanceof Response);
  assert.equal(completed.headers.get("Location"), "/account?save=42");
  assert.equal(verify.mock.calls[0].arguments[0]!.pendingAuthenticationToken, "pending-secret");
  assert.match(completed.headers.get("Set-Cookie")!, /scholarable-signup-flow=/);
});

test("reset links are removed from the URL and never returned in page data", async (t) => {
  const response = await loader(args("/auth/reset-password?token=reset-secret"));
  assert.ok(response instanceof Response);
  assert.equal(response.headers.get("Location"), "/auth/reset-password");
  const cookie = cookiePair(response.headers.get("Set-Cookie")!);
  const page = await loader(args("/auth/reset-password", undefined, cookie));
  assert.ok(!(page instanceof Response));
  assert.equal(page.data.step, "new-password");
  assert.doesNotMatch(JSON.stringify(page.data), /reset-secret/);
  const reset = t.mock.method(getWorkOS().userManagement, "resetPassword", async () => ({ user: authResponse.user }));
  const completed = await action(args("/auth/reset-password", { intent: "reset", password: "new-strong-password" }, cookie));
  assert.ok(!(completed instanceof Response));
  assert.equal(reset.mock.calls[0].arguments[0]!.token, "reset-secret");
  assert.equal(completed.data.message, "Passwort geändert. Du kannst dich jetzt mit dem neuen Passwort anmelden.");
  assert.match(new Headers(completed.init?.headers).get("Set-Cookie")!, /Max-Age=0/);
});

test("login rejects cross-origin, oversized and invalid requests before calling WorkOS", async (t) => {
  const authenticate = t.mock.method(getWorkOS().userManagement, "authenticateWithPassword", async () => authResponse);
  await assert.rejects(action(args("/auth/sign-in", { intent: "sign-in", email: "student@example.com", password: "password" }, undefined, "https://evil.invalid")), (e) => e instanceof Response && e.status === 403);
  await assert.rejects(action(args("/auth/sign-in", { intent: "sign-in", password: "x".repeat(9000) })), (e) => e instanceof Response && e.status === 413);
  const invalid = await action(args("/auth/sign-in", { intent: "sign-in", email: "bad", password: "password" }));
  assert.ok(!(invalid instanceof Response));
  assert.equal(invalid.init?.status, 400);
  const expired = await action(args("/auth/sign-in", { intent: "verify", code: "123456" }));
  assert.ok(!(expired instanceof Response));
  assert.match(expired.data.error!, /abgelaufen/);
  assert.equal(authenticate.mock.callCount(), 0);
});

test("return targets and pending cookies cannot redirect outside known account routes", async () => {
  for (const value of ["https://evil.invalid", "//evil.invalid", "/account/../auth/other", "/account?save=0", "/account%2f..", "/profile?next=https://evil.invalid"]) assert.equal(authReturnTo(value), "/account");
  assert.equal(authReturnTo("/account/applications/42"), "/account/applications/42");
  const request = args("/auth/sign-in").request;
  const cookie = await pendingCookie(request, env.WORKOS_COOKIE_PASSWORD, { kind: "verify", token: "secret", returnTo: "/account" });
  assert.equal(await readPending(new Request("https://other.invalid/auth/sign-in", { headers: { Cookie: cookiePair(cookie) } }), env.WORKOS_COOKIE_PASSWORD), null);
  assert.equal(await readPending(new Request(request.url, { headers: { Cookie: cookiePair(cookie).slice(0, -8) + "tampered" } }), env.WORKOS_COOKIE_PASSWORD), null);
});

test("recovery hides account existence, and SDK failures never expose their messages", async (t) => {
  const users = getWorkOS().userManagement;
  const reset = t.mock.method(users, "createPasswordReset", async () => { throw { status: 404, message: "private-sdk-detail" }; });
  const missing = await action(args("/auth/reset-password", { intent: "forgot", email: "missing@example.com" }));
  assert.ok(!(missing instanceof Response));
  reset.mock.mockImplementation(async () => ({ object: "password_reset" as const, id: "reset", userId: "user", email: "existing@example.com", expiresAt: "", createdAt: "", passwordResetToken: "secret", passwordResetUrl: "https://students.scholarable.test/auth/reset-password?token=secret" }));
  const existing = await action(args("/auth/reset-password", { intent: "forgot", email: "existing@example.com" }));
  assert.deepEqual(existing, missing);
  t.mock.method(users, "authenticateWithPassword", async () => { throw { status: 429, message: "private-sdk-detail" }; });
  const limited = await action(args("/auth/sign-in", { intent: "sign-in", email: "student@example.com", password: "password" }));
  assert.ok(!(limited instanceof Response));
  assert.equal(limited.init?.status, 429);
  assert.doesNotMatch(JSON.stringify(limited), /private-sdk-detail|password"/);
});

test("unverified and impersonated responses cannot establish a student session", async (t) => {
  const authenticate = t.mock.method(getWorkOS().userManagement, "authenticateWithPassword", async () => ({ ...authResponse, user: { ...authResponse.user, emailVerified: false } }));
  for (const response of [{ ...authResponse, user: { ...authResponse.user, emailVerified: false } }, { ...authResponse, impersonator: { email: "admin@example.com", reason: "support" } }]) {
    authenticate.mock.mockImplementation(async () => response);
    const result = await action(args("/auth/sign-in", { intent: "sign-in", email: "student@example.com", password: "password" }));
    assert.ok(!(result instanceof Response));
    assert.equal(result.init?.status, 403);
    assert.equal(new Headers(result.init?.headers).get("Set-Cookie"), null);
  }
});

test("the explicit hosted fallback retains project binding and PKCE", async () => {
  const { loader: otherLoader } = await import("../routes/auth-other");
  const response = await otherLoader(args("/auth/other?returnTo=%2Fprofile"));
  assert.equal(response.status, 302);
  const url = new URL(response.headers.get("Location")!);
  assert.equal(url.searchParams.get("client_id"), env.WORKOS_CLIENT_ID);
  assert.equal(url.searchParams.get("redirect_uri"), env.WORKOS_REDIRECT_URI);
  assert.match(response.headers.get("Set-Cookie")!, /wos-auth-verifier-/);
  assert.doesNotMatch(url.href, /sk_test|postgres/);
});

test("Google signup selects only GoogleOAuth while preserving project binding, PKCE and signup measurement", async () => {
  const { loader: otherLoader } = await import("../routes/auth-other");
  const response = await otherLoader(args("/auth/other?provider=google&signup=1&returnTo=%2Faccount%3Fsave%3D42"));
  const url = new URL(response.headers.get("Location")!);
  assert.equal(url.searchParams.get("provider"), "GoogleOAuth");
  assert.equal(url.searchParams.has("screen_hint"), false);
  assert.equal(url.searchParams.get("client_id"), env.WORKOS_CLIENT_ID);
  assert.equal(url.searchParams.get("redirect_uri"), env.WORKOS_REDIRECT_URI);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("code_challenge"));
  assert.ok(url.searchParams.get("state"));
  assert.match(response.headers.get("Set-Cookie")!, /wos-auth-verifier-/);
  assert.match(response.headers.get("Set-Cookie")!, /scholarable-signup-flow=/);
  const hostile = await otherLoader(args("/auth/other?provider=https://evil.invalid&returnTo=https://evil.invalid"));
  assert.equal(new URL(hostile.headers.get("Location")!).searchParams.get("provider"), "authkit");
});

test("authentication preserves the profile handoff and selected opportunity", () => {
  assert.equal(authReturnTo("/profile?save=42"), "/profile?save=42");
});
