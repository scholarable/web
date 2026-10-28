import { useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/match";
import { loadProfileOptions } from "../lib/matches.server";
import { browseServingCalls } from "../lib/serving.server";
import { requireStudentAuth, studentAuthLoader, studentAuthEnv, studentAuthReady, studentConnection } from "../lib/student-auth.server";
import { readStudentProgress } from "../lib/student-progress.server";
import { chatAiReady, type ChatEnv } from "../lib/chat-understanding.server";
import type { DiscoveryFacts } from "../lib/discovery";
import { DiscoveryChat } from "../components/discovery-chat";

export { markCorrection } from "../components/discovery-chat";
export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
export const meta = () => [{ title: "Scholarable | Finde dein Stipendium" }];

export async function loader(args: Route.LoaderArgs) {
  const { request, context } = args;
  const env = (context as { cloudflare?: { env?: object } }).cloudflare?.env;
  const cvEnv = env as { AI?: unknown; SCHOLARABLE_CV_IMPORT_ENABLED?: string } | undefined;
  const [options, list] = await Promise.all([loadProfileOptions(env), browseServingCalls(new URL(request.url), env)]);
  const base = { options, list, cvImport: cvEnv?.SCHOLARABLE_CV_IMPORT_ENABLED === "true" && !!cvEnv.AI, chatAi: chatAiReady(env as ChatEnv | undefined),
    studentAccounts: studentAuthReady(request, studentAuthEnv(context)), signedIn: false, savedIds: [] as string[],
    initialFacts: {} as DiscoveryFacts, adultConfirmed: false, savedContextUnavailable: false };
  if (!base.studentAccounts) return base;
  try {
    requireStudentAuth(request, studentAuthEnv(context));
    return await studentAuthLoader<typeof base>(args, async ({ auth, getAccessToken }) => {
      if (!auth.user?.emailVerified || auth.impersonator) return base;
      const token = getAccessToken();
      if (!token) return base;
      const { query, digest } = await studentConnection(context, auth.user.id, token);
      const progress = await readStudentProgress(query, digest);
      const initialFacts = Object.fromEntries(Object.entries(progress.profile || {}).filter(([field]) => field !== "adult_confirmation").map(([field, fact]) => [field === "milestone" ? "future_plan" : field, fact.value_state === "prefer_not_to_say" ? "prefer_not_to_say" : String(fact.value ?? "")])) as DiscoveryFacts;
      return { ...base, signedIn: true, initialFacts, adultConfirmed: progress.profile?.adult_confirmation?.value === true,
        savedIds: progress.opportunities.filter(item => item.disposition === "saved").map(item => String(item.call_id)) };
    });
  } catch { return { ...base, savedContextUnavailable: true }; }
}

export default function Match() {
  return <ScholarshipDiscovery />;
}

// One front door: the blue chat screen, nothing below it (owner, 2026-10-28).
// The list it sorts is the Stipendien page; the answers travel there in this
// tab's memory. The loader still reads every listed call, because the chat
// counts them and places the student's university.
export function ScholarshipDiscovery() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const items = data.list.state === "ready" ? data.list.scholarships : [];
  const total = data.list.state === "ready" ? data.list.total : 0;
  return <main className="discover">
    {data.savedContextUnavailable && <p className="notice" role="status">Deine gespeicherten Angaben konnten nicht geladen werden. Du kannst anonym weitermachen.</p>}
    <DiscoveryChat options={data.options} items={items} total={total} studentAccounts={data.studentAccounts} cvImport={data.cvImport} chatAi={data.chatAi}
      initialFacts={data.initialFacts} adultConfirmed={data.adultConfirmed} manualEntry={searchParams.get("mode") === "form"} />
  </main>;
}
