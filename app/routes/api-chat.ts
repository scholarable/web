import type { Route } from "./+types/api-chat";
import { chatResponse, type ChatEnv } from "../lib/chat-understanding.server";
import { loadProfileOptions } from "../lib/matches.server";

export function action({ request, context }: Route.ActionArgs) {
  const env = (context as { cloudflare?: { env?: object } }).cloudflare?.env;
  return chatResponse(request, env as ChatEnv | undefined, () => loadProfileOptions(env));
}
export function loader({ request }: Route.LoaderArgs) { return chatResponse(request, undefined, async () => ({ institution: [], subject: [], usesStudyPlan: false })); }
