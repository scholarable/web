import { authkitLoader } from "@workos-inc/authkit-react-router";
import type { Route } from "./+types/document-download";
import { requireStudentAuth, studentAuthEnv, studentConnection } from "../lib/student-auth.server";
import { documentEnv, downloadDocument } from "../lib/student-documents.server";

export async function loader(args: Route.LoaderArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context));
  return authkitLoader(args, async ({ auth, getAccessToken }) => {
    if (!auth.user.emailVerified || auth.impersonator) throw new Response("Verified student account required", { status: 403 });
    const { query, digest } = await studentConnection(args.context, auth.user.id, getAccessToken());
    return downloadDocument(query, digest, documentEnv(args.context), args.params.documentId || "", Number(args.params.version));
  }, { ensureSignedIn: true });
}
