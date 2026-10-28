import { authkitLoader as hostedAuthkitLoader, configure } from "@workos-inc/authkit-react-router";
import { redirect } from "react-router";
import { decodeJwt } from "jose";
import { demoMode } from "./demo-mode";
import { studentDataQuery, studentSubjectDigest, type VerifiedStudentPrincipal } from "./student-progress.server";

export type StudentAuthEnv = {
  SCHOLARABLE_STUDENT_AUTH_ENABLED?: string;
  SCHOLARABLE_STUDENT_DATABASE_URL?: string;
  SCHOLARABLE_SERVING_DATABASE_URL?: string;
  SCHOLARABLE_STUDENT_IDENTITY_KEY?: string;
  SCHOLARABLE_TEST_ACCOUNT_EMAIL?: string;
  WORKOS_CLIENT_ID?: string;
  WORKOS_API_KEY?: string;
  WORKOS_REDIRECT_URI?: string;
  WORKOS_COOKIE_PASSWORD?: string;
};

let configured: string | undefined;

export function studentAuthEnv(context: unknown): StudentAuthEnv | undefined {
  return (context as { cloudflare?: { env?: StudentAuthEnv } })?.cloudflare?.env;
}

export function studentAuthReady(request: Request, env: StudentAuthEnv | undefined): boolean {
  if (demoMode || env?.SCHOLARABLE_STUDENT_AUTH_ENABLED !== "true") return false;
  const origin = new URL(request.url).origin;
  const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  const key = env.SCHOLARABLE_STUDENT_IDENTITY_KEY || "";
  let validKey = false;
  try {
    if (/^[A-Za-z0-9_-]+$/.test(key)) validKey = atob(key.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(key.length / 4) * 4, "=")).length >= 32;
  } catch { /* An invalid HMAC key must never open account routes. */ }
  return !!(env.WORKOS_CLIENT_ID && env.WORKOS_API_KEY && env.WORKOS_COOKIE_PASSWORD && env.WORKOS_COOKIE_PASSWORD.length >= 32
    && validKey && env.SCHOLARABLE_STUDENT_DATABASE_URL
    && (local || origin.startsWith("https://"))
    && env.WORKOS_REDIRECT_URI === `${origin}/auth/callback`);
}

export function requireStudentAuth(request: Request, env: StudentAuthEnv | undefined): StudentAuthEnv {
  if (demoMode || env?.SCHOLARABLE_STUDENT_AUTH_ENABLED !== "true") {
    throw new Response("Not found", { status: 404 });
  }
  const { WORKOS_CLIENT_ID: clientId, WORKOS_API_KEY: apiKey,
    WORKOS_REDIRECT_URI: redirectUri, WORKOS_COOKIE_PASSWORD: cookiePassword,
    SCHOLARABLE_STUDENT_IDENTITY_KEY: identityKey, SCHOLARABLE_STUDENT_DATABASE_URL: databaseUrl } = env;
  if (!studentAuthReady(request, env) || !clientId || !apiKey || !redirectUri || !cookiePassword || !identityKey || !databaseUrl) {
    throw new Response("Student accounts are not configured", { status: 503 });
  }
  // AuthKit caches its WorkOS client and cookie storage per Worker isolate.
  // Never silently mix two credential sets in one isolate.
  const settings = JSON.stringify([clientId, apiKey, redirectUri, cookiePassword]);
  if (configured && configured !== settings) throw new Response("Student accounts are not configured", { status: 503 });
  if (!configured) {
    configure({ clientId, apiKey, redirectUri, cookiePassword,
      cookieName: "scholarable-session", cookieMaxAge: 7 * 24 * 60 * 60 }, () => undefined);
    configured = settings;
  }
  return env;
}

export function requireSameOriginPost(request: Request): void {
  const origin = new URL(request.url).origin;
  const sameOrigin = request.headers.get("Origin") === origin;
  // Sandboxed in-app browsers send Origin: null for document form navigation.
  // Accept that case only for local development and a browser-confirmed same-origin navigation.
  const localDocumentPost = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
    && request.headers.get("Origin") === "null"
    && request.headers.get("Sec-Fetch-Site") === "same-origin"
    && request.headers.get("Sec-Fetch-Mode") === "navigate"
    && request.headers.get("Sec-Fetch-Dest") === "document";
  if (request.method !== "POST" || (!sameOrigin && !localDocumentPost)) {
    throw new Response("Same-origin POST required", { status: 403 });
  }
}

// Call only after AuthKit verifies the session signature, issuer and expiry.
export function principalFromVerifiedSession(accessToken: string, userId: string, clientId: string): VerifiedStudentPrincipal {
  const claims = decodeJwt(accessToken);
  if (!claims.iss || claims.sub !== userId || claims.client_id !== clientId || claims.act) {
    throw new Response("Verified student identity required", { status: 403 });
  }
  return { issuer: claims.iss, subject: userId };
}

export async function studentConnection(context: unknown, userId: string, accessToken: string) {
  const env = studentAuthEnv(context);
  if (!env?.SCHOLARABLE_STUDENT_IDENTITY_KEY || !env.WORKOS_CLIENT_ID) throw new Response("Student identity unavailable", { status: 503 });
  const principal = principalFromVerifiedSession(accessToken, userId, env.WORKOS_CLIENT_ID);
  const digest = await studentSubjectDigest(principal, env.SCHOLARABLE_STUDENT_IDENTITY_KEY);
  const query = await studentDataQuery(env);
  if ((env as StudentAuthEnv & { SCHOLARABLE_DOCUMENTS_ENABLED?: string }).SCHOLARABLE_DOCUMENTS_ENABLED === "true")
    await query("select touch_student_activity(decode($1, 'hex'))", [digest]);
  return { query, digest };
}

// Preserve AuthKit's verification/refresh and authorized-loader types while routing
// signed-out students through Scholarable's login page.
export const studentAuthLoader: typeof hostedAuthkitLoader = (async (...args: Parameters<typeof hostedAuthkitLoader>) => {
  try { return await hostedAuthkitLoader(...args); }
  catch (error) {
    if (error instanceof Response && error.status === 302) {
      const location = error.headers.get("Location");
      if (location && new URL(location, args[0].request.url).origin === "https://api.workos.com"
        && new URL(location, args[0].request.url).pathname === "/user_management/authorize") {
        const url = new URL(args[0].request.url);
        const headers = new Headers(error.headers);
        headers.delete("Location");
        throw redirect(`/auth/sign-in?returnTo=${encodeURIComponent(url.pathname + url.search)}`, { headers });
      }
    }
    throw error;
  }
}) as typeof hostedAuthkitLoader;
