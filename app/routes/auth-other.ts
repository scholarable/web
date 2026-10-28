import { getSignInUrl } from "@workos-inc/authkit-react-router";
import { redirect } from "react-router";
import type { Route } from "./+types/auth-other";
import { authHeaders, authReturnTo } from "../lib/custom-auth.server";
import { signupFlowCookie, writeDiscoveryEvent, type DiscoveryAnalyticsEnv } from "../lib/discovery-analytics.server";
import { requireStudentAuth, studentAuthEnv } from "../lib/student-auth.server";

// Explicit fallback for configured OAuth/SSO, passkeys and advanced challenges.
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = requireStudentAuth(request, studentAuthEnv(context));
  const params = new URL(request.url).searchParams;
  const { url, headers } = await getSignInUrl(authReturnTo(params.get("returnTo")), request);
  const destination = new URL(url);
  // Keep the SDK's sealed state and browser-bound PKCE verifier; only select
  // the documented Google provider instead of the hosted provider chooser.
  if (params.get("provider") === "google") {
    destination.searchParams.set("provider", "GoogleOAuth");
    // screen_hint belongs to hosted AuthKit; direct OAuth rejects it.
    destination.searchParams.delete("screen_hint");
  }
  const responseHeaders = new Headers({ ...authHeaders, ...headers });
  if (params.get("signup") === "1") {
    writeDiscoveryEvent(env as DiscoveryAnalyticsEnv, { event: "signup_started" });
    responseHeaders.append("Set-Cookie", await signupFlowCookie(env.WORKOS_COOKIE_PASSWORD!));
  }
  return redirect(destination.href, { headers: responseHeaders });
}
