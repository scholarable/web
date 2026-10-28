import type { Route } from "./+types/api-cv-import";
import { cvImportResponse } from "../lib/cv-import.server";

export function action({ request, context }: Route.ActionArgs) {
  return cvImportResponse(request, (context as { cloudflare?: { env?: object } }).cloudflare?.env);
}

export function loader({ request }: Route.LoaderArgs) {
  return cvImportResponse(request);
}
