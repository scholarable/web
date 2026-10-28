import { authkitLoader, getWorkOS, saveSession } from "@workos-inc/authkit-react-router";
import { EncryptJWT, jwtDecrypt } from "jose";
import { createCookie, data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { requireSameOriginPost, requireStudentAuth, studentAuthEnv } from "./student-auth.server";
import { signupFlowCookie, writeDiscoveryEvent, type DiscoveryAnalyticsEnv } from "./discovery-analytics.server";

export type AuthPageData = { mode: "sign-in" | "sign-up" | "reset-password"; step: "credentials" | "verify" | "new-password"; returnTo: string; email?: string; error?: string; message?: string };
type Pending = { kind: "verify" | "reset"; token: string; email?: string; returnTo: string };
export const authHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };
const cookie = (request: Request) => createCookie("scholarable-auth-pending", { path: "/auth", httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", maxAge: 600 });
async function key(secret: string) { return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`scholarable-auth-pending:${secret}`))); }
export function authReturnTo(value: string | null): string {
  // Only known private destinations; no absolute URLs, encodings or traversal.
  // A scholarship page may be returned to with the call to save selected.
  return value && /^\/(?:account(?:\/download|\/practice-scholarship|\/applications\/[1-9][0-9]{0,17})?|profile|scholarships(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,118})?)(?:\?save=[1-9][0-9]{0,17})?$/.test(value) ? value : "/account";
}
export async function pendingCookie(request: Request, secret: string, pending: Pending): Promise<string> {
  const sealed = await new EncryptJWT(pending).setProtectedHeader({ alg: "dir", enc: "A256GCM" }).setIssuer("scholarable-auth").setAudience(new URL(request.url).origin).setIssuedAt().setExpirationTime("10m").encrypt(await key(secret));
  return cookie(request).serialize(sealed);
}
export async function readPending(request: Request, secret: string): Promise<Pending | null> {
  try {
    const sealed = await cookie(request).parse(request.headers.get("Cookie"));
    if (typeof sealed !== "string") return null;
    const { payload } = await jwtDecrypt(sealed, await key(secret), { issuer: "scholarable-auth", audience: new URL(request.url).origin });
    if (!["verify", "reset"].includes(String(payload.kind)) || typeof payload.token !== "string" || typeof payload.returnTo !== "string") return null;
    return { kind: payload.kind as Pending["kind"], token: payload.token, returnTo: authReturnTo(payload.returnTo), ...(typeof payload.email === "string" ? { email: payload.email } : {}) };
  } catch { return null; }
}
const clearPending = (request: Request) => cookie(request).serialize("", { maxAge: 0 });
function pageData(request: Request, pending: Pending | null): AuthPageData {
  const url = new URL(request.url);
  const mode = url.pathname.endsWith("sign-up") ? "sign-up" : url.pathname.endsWith("reset-password") ? "reset-password" : "sign-in";
  const save = url.searchParams.get("save");
  const returnTo = authReturnTo(url.searchParams.get("returnTo") || (save ? `/account?save=${save}` : null));
  const relevant = mode === "reset-password" ? pending?.kind === "reset" : pending?.kind === "verify" && pending.returnTo === returnTo;
  return { mode, returnTo, step: relevant ? pending!.kind === "reset" ? "new-password" : "verify" : "credentials", ...(relevant && pending?.email ? { email: pending.email } : {}) };
}
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = requireStudentAuth(request, studentAuthEnv(context));
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (url.pathname.endsWith("reset-password") && token) {
    if (token.length > 2048) throw new Response("Invalid reset link", { status: 400, headers: authHeaders });
    return redirect("/auth/reset-password", { headers: { ...authHeaders, "Set-Cookie": await pendingCookie(request, env.WORKOS_COOKIE_PASSWORD!, { kind: "reset", token, returnTo: "/account" }) } });
  }
  return data(pageData(request, await readPending(request, env.WORKOS_COOKIE_PASSWORD!)), { headers: authHeaders });
}
export async function action(args: ActionFunctionArgs) {
  const { request, context } = args;
  const env = requireStudentAuth(request, studentAuthEnv(context));
  requireSameOriginPost(request);
  if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) throw new Response("Form encoding required", { status: 415 });
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let body = "", size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new Response("Form too large", { status: 413 }); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  }
  const form = new URLSearchParams(body);
  const pending = await readPending(request, env.WORKOS_COOKIE_PASSWORD!);
  const page = pageData(request, pending);
  const reply = (extra: Partial<AuthPageData>, status = 400, additionalHeaders?: HeadersInit) => data({ ...page, ...extra }, { status, headers: { ...authHeaders, ...Object.fromEntries(new Headers(additionalHeaders)) } });
  const intent = form.get("intent");
  if (intent === "restart") return redirect("/auth/sign-in" + `?returnTo=${encodeURIComponent(page.returnTo)}`, { headers: { ...authHeaders, "Set-Cookie": await clearPending(request) } });
  const email = (form.get("email") || "").trim();
  const password = form.get("password") || "";
  const code = (form.get("code") || "").trim();
  if (intent === "verify") {
    if (page.step !== "verify" || pending?.kind !== "verify") return reply({ step: "credentials", error: "Deine Bestätigung ist abgelaufen. Melde dich noch einmal an, um einen neuen Code zu bekommen." });
    if (!/^\d{6}$/.test(code)) return reply({ error: "Gib den sechsstelligen Code aus deiner E-Mail ein." });
  } else if (intent === "reset") {
    if (pending?.kind !== "reset" || page.mode !== "reset-password") return reply({ error: "Öffne einen neuen Link zum Zurücksetzen aus deiner E-Mail." });
    if (password.length < 10 || password.length > 1024) return reply({ error: "Nimm ein Passwort mit 10 bis 1.024 Zeichen." });
  } else {
    if (!["sign-in", "sign-up", "forgot"].includes(intent || "") || (intent === "forgot" ? page.mode !== "reset-password" : intent !== page.mode)) return reply({ error: "Wähl eine gültige Anmelde-Aktion." });
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: "Gib eine gültige E-Mail-Adresse ein." });
    if (intent !== "forgot" && (!password || password.length > 1024 || (intent === "sign-up" && password.length < 10))) return reply({ email, error: intent === "sign-up" ? "Nimm ein Passwort mit 10 bis 1.024 Zeichen." : "Gib dein Passwort ein." });
  }
  const users = getWorkOS().userManagement;
  try {
    if (intent === "forgot") {
      try { await users.createPasswordReset({ email }); }
      catch (error) { if ((error as { status?: number }).status !== 404 && (error as { code?: string }).code !== "user_not_found") throw error; }
      return reply({ message: "Wenn es ein Konto mit dieser E-Mail gibt, bekommst du gleich einen Link zum Zurücksetzen." }, 200);
    }
    if (intent === "reset") {
      await users.resetPassword({ token: pending!.token, newPassword: password });
      return reply({ step: "credentials", message: "Passwort geändert. Du kannst dich jetzt mit dem neuen Passwort anmelden." }, 200, { "Set-Cookie": await clearPending(request) });
    }
    if (intent === "sign-up") {
      await users.createUser({ email, password });
      writeDiscoveryEvent(env as DiscoveryAnalyticsEnv, { event: "signup_started" });
    }
    const auth = intent === "verify"
      ? await users.authenticateWithEmailVerification({ clientId: env.WORKOS_CLIENT_ID!, pendingAuthenticationToken: pending!.token, code })
      : await users.authenticateWithPassword({ clientId: env.WORKOS_CLIENT_ID!, email, password });
    if (!auth.user.emailVerified || auth.impersonator) return reply({ error: "Dafür brauchst du ein bestätigtes Konto." }, 403);
    // Initialize the SDK cookie store on a cold Worker without refreshing an old login.
    await authkitLoader({ ...args, request: new Request(request.url) });
    const session = await saveSession(auth, request);
    const responseHeaders = new Headers({ ...authHeaders, ...session.headers });
    responseHeaders.append("Set-Cookie", await clearPending(request));
    if (page.mode === "sign-up") responseHeaders.append("Set-Cookie", await signupFlowCookie(env.WORKOS_COOKIE_PASSWORD!));
    return redirect(page.returnTo, { status: 303, headers: responseHeaders });
  } catch (error) {
    // Never send SDK error messages, tokens or credentials to the browser/logs.
    const failure = error as { status?: number; code?: string; rawData?: { code?: string; pending_authentication_token?: string; email?: string } };
    if (failure.rawData?.code === "email_verification_required" && failure.rawData.pending_authentication_token && failure.rawData.pending_authentication_token.length <= 2048) {
      return reply({ step: "verify", email: failure.rawData.email || email }, 200, { "Set-Cookie": await pendingCookie(request, env.WORKOS_COOKIE_PASSWORD!, { kind: "verify", token: failure.rawData.pending_authentication_token, email: failure.rawData.email || email, returnTo: page.returnTo }) });
    }
    if (failure.status === 429) return reply({ error: "Zu viele Versuche. Warte kurz und versuch es dann noch einmal." }, 429);
    if (!failure.status || failure.status >= 500) return reply({ error: "Die Anmeldung ist gerade nicht erreichbar. Versuch es gleich noch einmal." }, 503);
    if (failure.rawData?.code && /mfa|sso|organization|radar|authentication_method/.test(failure.rawData.code)) return reply({ error: "Dieses Konto braucht einen weiteren Anmeldeschritt. Nutz unten „Andere Anmeldemöglichkeiten“." });
    return reply({ ...(intent === "verify" || intent === "reset" ? {} : { email }), error: intent === "verify" ? "Der Code ist falsch oder abgelaufen. Versuch es noch einmal oder fang neu an, um einen neuen Code zu bekommen." : intent === "reset" ? "Der Link ist abgelaufen oder das Passwort ist nicht sicher genug. Nimm ein stärkeres Passwort oder fordere einen neuen Link an." : intent === "sign-up" ? "Das Konto konnte nicht erstellt werden. Nimm ein stärkeres Passwort oder melde dich an, wenn du schon ein Konto hast." : "Anmeldung fehlgeschlagen. Prüf E-Mail und Passwort oder setz dein Passwort zurück." });
  }
}
