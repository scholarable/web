export const discoveryEvents = [
  "enrichment_selected", "enrichment_switched", "clarification", "correction",
  "first_result", "abandonment", "signup_started", "signup_completed",
] as const;

export type DiscoveryEventName = typeof discoveryEvents[number];
export type DiscoveryEvent = {
  event: DiscoveryEventName;
  enrichment?: "linkedin" | "cv" | "guided" | "skip" | "manual";
  elapsedMs?: number;
};

type AnalyticsDataset = { writeDataPoint(point: { blobs: string[]; doubles: number[] }): void };
export type DiscoveryAnalyticsEnv = { SCHOLARABLE_DISCOVERY_ANALYTICS?: AnalyticsDataset };
const signupCookie = "scholarable-signup-flow";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signupFlowCookie(secret: string, now = Date.now()): Promise<string> {
  const expires = String(now + 15 * 60 * 1000);
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), new TextEncoder().encode(expires));
  return `${signupCookie}=${expires}.${base64url(new Uint8Array(signature))}; Path=/account; Max-Age=900; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSignupFlowCookie(): string {
  return `${signupCookie}=; Path=/account; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export async function validSignupFlow(request: Request, secret: string, now = Date.now()): Promise<boolean> {
  const encoded = request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${signupCookie}=`))?.slice(signupCookie.length + 1);
  const [expires, signature] = encoded?.split(".") || [];
  if (!expires || !signature || !/^\d{13}$/.test(expires) || Number(expires) < now) return false;
  try {
    const bytes = Uint8Array.from(atob(signature.replaceAll("-", "+").replaceAll("_", "/")), (character) => character.charCodeAt(0));
    return crypto.subtle.verify("HMAC", await signingKey(secret), bytes, new TextEncoder().encode(expires));
  } catch { return false; }
}

export function parseDiscoveryEvent(value: unknown): DiscoveryEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["event", "enrichment", "elapsedMs"].includes(key))) return null;
  if (!discoveryEvents.includes(record.event as DiscoveryEventName)) return null;
  const event = record.event as DiscoveryEventName;
  const choices = ["linkedin", "cv", "guided", "skip", "manual"];
  if (record.enrichment !== undefined && !choices.includes(String(record.enrichment))) return null;
  if (record.elapsedMs !== undefined && (!Number.isInteger(record.elapsedMs) || Number(record.elapsedMs) < 0 || Number(record.elapsedMs) > 86_400_000)) return null;
  const measuresEnrichment = event === "enrichment_selected" || event === "enrichment_switched";
  const measuresTime = event === "first_result" || event === "abandonment";
  if (measuresEnrichment !== (record.enrichment !== undefined) || measuresTime !== (record.elapsedMs !== undefined)) return null;
  return { event,
    ...(record.enrichment === undefined ? {} : { enrichment: record.enrichment as DiscoveryEvent["enrichment"] }),
    ...(record.elapsedMs === undefined ? {} : { elapsedMs: Number(record.elapsedMs) }) };
}

export function writeDiscoveryEvent(env: DiscoveryAnalyticsEnv | undefined, event: DiscoveryEvent): void {
  env?.SCHOLARABLE_DISCOVERY_ANALYTICS?.writeDataPoint({
    blobs: [event.event, event.enrichment || ""],
    doubles: [event.elapsedMs ?? 0],
  });
}
