import type { Route } from "./+types/api-discovery-events";
import { parseDiscoveryEvent, writeDiscoveryEvent, type DiscoveryAnalyticsEnv } from "../lib/discovery-analytics.server";
import { requireSameOriginPost } from "../lib/student-auth.server";

export async function action({ request, context }: Route.ActionArgs) {
  requireSameOriginPost(request);
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw new Response("JSON required", { status: 415 });
  if (Number(request.headers.get("Content-Length") || 0) > 512) throw new Response("Event too large", { status: 413 });
  let value: unknown;
  try {
    const body = await request.text();
    if (body.length > 512) throw new Response("Event too large", { status: 413 });
    value = JSON.parse(body);
  }
  catch (error) {
    if (error instanceof Response) throw error;
    throw new Response("Invalid event", { status: 400 });
  }
  const event = parseDiscoveryEvent(value);
  if (!event || event.event === "signup_started" || event.event === "signup_completed") {
    throw new Response("Invalid event", { status: 400 });
  }
  writeDiscoveryEvent((context as { cloudflare?: { env?: DiscoveryAnalyticsEnv } }).cloudflare?.env, event);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export function loader() { throw new Response("Method not allowed", { status: 405 }); }
