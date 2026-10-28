import { authkitLoader } from "@workos-inc/authkit-react-router";
import type { Route } from "./+types/answer-library-download";
import { requireStudentAuth, studentAuthEnv, studentConnection } from "../lib/student-auth.server";
import { readStudentAnswerLibrary } from "../lib/student-progress.server";

export async function loader(args: Route.LoaderArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context));
  if (!/^[1-9][0-9]{0,17}$/.test(args.params.itemId || "")) throw new Response("Answer not found", { status: 404 });
  return authkitLoader(args, async ({ auth, getAccessToken }) => {
    if (!auth.user.emailVerified || auth.impersonator) throw new Response("Verified student account required", { status: 403 });
    const { query, digest } = await studentConnection(args.context, auth.user.id, getAccessToken());
    const item = (await readStudentAnswerLibrary(query, digest)).find(entry => entry.id === args.params.itemId);
    if (!item) throw new Response("Answer not found", { status: 404 });
    return new Response(JSON.stringify(item), { headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename=scholarable-answer-${item.id}.json`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    } });
  }, { ensureSignedIn: true });
}
