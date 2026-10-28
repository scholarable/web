import { studentAuthLoader as authkitLoader } from "../lib/student-auth.server";
import type { Route } from "./+types/account-download";
import { readStudentAnswerLibrary, readStudentApplicationWorkspaces, readStudentProfileSnapshots, readStudentProfileVault, readStudentProgress } from "../lib/student-progress.server";
import { requireStudentAuth, studentAuthEnv, studentConnection } from "../lib/student-auth.server";
import { documentEnv, readDocuments } from "../lib/student-documents.server";

export async function loader(args: Route.LoaderArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context));
  return authkitLoader(args, async ({ auth, getAccessToken }) => {
    if (!auth.user.emailVerified || auth.impersonator) throw new Response("Verified student account required", { status: 403 });
    const { query, digest } = await studentConnection(args.context, auth.user.id, getAccessToken());
    const [progress, profile_vault, application_profile_snapshots, application_workspaces, answer_library] = await Promise.all([
      readStudentProgress(query, digest), readStudentProfileVault(query, digest), readStudentProfileSnapshots(query, digest),
      readStudentApplicationWorkspaces(query, digest), readStudentAnswerLibrary(query, digest),
    ]);
    const document_library = documentEnv(args.context).SCHOLARABLE_DOCUMENTS_ENABLED === "true" ? await readDocuments(query, digest) : [];
    return new Response(JSON.stringify({ exported_at: new Date().toISOString(), ...progress, profile_vault, application_profile_snapshots, application_workspaces, answer_library, document_library }), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": "attachment; filename=scholarable-account-data.json",
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" },
    });
  }, { ensureSignedIn: true });
}
