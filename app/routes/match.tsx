import { useLoaderData, useLocation, useSearchParams } from "react-router";
import type { Route } from "./+types/match";
import { loadProfileOptions } from "../lib/matches.server";
import { browseServingCalls } from "../lib/serving.server";
import { browsePageHref } from "../lib/browse";
import { requireStudentAuth, studentAuthLoader, studentAuthEnv, studentAuthReady, studentConnection } from "../lib/student-auth.server";
import { readStudentProgress } from "../lib/student-progress.server";
import { chatAiReady, type ChatEnv } from "../lib/chat-understanding.server";
import { useAnswers } from "../lib/discovery-answers";
import type { DiscoveryFacts } from "../lib/discovery";
import { dateLong } from "../lib/copy-de";
import { DiscoveryChat } from "../components/discovery-chat";
import { CardList, ListSummary, ListTools } from "../components/scholarship-list";

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

// One front door: the chat sorts and labels the list right below it. The
// list is there from the first second and never hides anything except calls
// whose published rules clearly conflict with an answer, which fold away.
export function ScholarshipDiscovery() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const answers = useAnswers();
  const { list } = data;
  const items = list.state === "ready" ? list.scholarships : [];
  const total = list.state === "ready" ? list.total : 0;
  const level = answers.result && answers.facts.degree_level ? answers.facts.degree_level : null;
  const lastChecked = items.map(item => item.lastChecked).filter((value): value is string => !!value).sort().at(-1);
  const save = { studentAccounts: data.studentAccounts, signedIn: data.signedIn, savedIds: data.savedIds };
  return <main className="discover">
    <DiscoveryChat options={data.options} items={items} total={total} studentAccounts={data.studentAccounts} cvImport={data.cvImport} chatAi={data.chatAi}
      initialFacts={data.initialFacts} adultConfirmed={data.adultConfirmed} manualEntry={searchParams.get("mode") === "form"} />
    <section className="list" id="list" aria-labelledby="list-h">
      {data.savedContextUnavailable && <p className="notice" role="status">Deine gespeicherten Angaben konnten nicht geladen werden. Du kannst anonym weitermachen.</p>}
      <div className="list-head"><h2 id="list-h">{level ? "Für dich sortiert" : "Alle Stipendien"}</h2>{items.length > 0 && <ListSummary items={items} total={total} soonOnly={list.soonOnly} />}</div>
      {list.state === "unavailable" ? <div className="notice" role="status"><h3>Liste gerade nicht verfügbar</h3><p>{list.reason}</p></div>
        : <>
          <ListTools path={pathname} filters={list} hash="#list" />
          {items.length === 0 ? <div className="notice"><h3>Keine Stipendien gefunden</h3><p>Versuch eine andere Auswahl oder schau später wieder vorbei.</p></div>
            : <CardList items={items} result={answers.result} level={level} filterLevel={list.degree} soonOnly={list.soonOnly} byAmount={list.byAmount} heading="h3" save={save}
              institution={answers.facts.institution || null} subject={answers.facts.subject || null} abroad={answers.facts.abroad || null} grouped={!list.search && !list.family}
              pages={{ page: 0, href: page => browsePageHref(list, page), startPage: true }} />}
          <p className="quiet-line">{lastChecked ? `Zuletzt geprüft am ${dateLong(lastChecked)}. ` : ""}Nur Angaben von den offiziellen Seiten der Anbieter. Regelbasierter Abgleich, keine Entscheidung über deine Berechtigung.</p>
        </>}
    </section>
  </main>;
}
