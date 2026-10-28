import { redirect } from "react-router";
import type { Route } from "./+types/hochschule";

// "Wähle deine Hochschule" on a family's grouped card: a plain GET form that
// works before the page's script loads. The chosen call's slug leads to that
// university's scholarship page; anything else leads to the list.
export const headers = () => ({ "Cache-Control": "no-store" });
export function loader({ request }: Route.LoaderArgs) {
  const call = new URL(request.url).searchParams.get("call") || "";
  return redirect(/^[a-z0-9-]{1,160}$/.test(call) ? `/scholarships/${call}` : "/scholarships");
}
