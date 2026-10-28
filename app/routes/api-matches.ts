import type { Route } from "./+types/api-matches";
import { matchesResponse } from "../lib/matches.server";

export function action({ request, context }: Route.ActionArgs) {
  return matchesResponse(request, (context as { cloudflare?: { env?: object } }).cloudflare?.env);
}
export function loader({ request }: Route.LoaderArgs) { return matchesResponse(request, undefined); }
