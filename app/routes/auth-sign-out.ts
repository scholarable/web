import { signOut } from "@workos-inc/authkit-react-router";
import type { Route } from "./+types/auth-sign-out";
import { requireSameOriginPost, requireStudentAuth, studentAuthEnv } from "../lib/student-auth.server";

export function action({ request, context }: Route.ActionArgs) {
  requireStudentAuth(request, studentAuthEnv(context));
  requireSameOriginPost(request);
  return signOut(request, { returnTo: new URL(request.url).origin });
}
