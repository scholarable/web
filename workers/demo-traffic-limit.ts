export type DemoTrafficEnv = {
  DEMO_TRAFFIC_LIMIT?: { limit(input: { key: string }): Promise<{ success: boolean }> };
};

// One shared sample-traffic bucket per Cloudflare location. No visitor identifiers
// or user-controlled keys; this is approximate burst protection, not a spend cap.
export async function withDemoTrafficLimit(
  request: Request, env: DemoTrafficEnv, next: () => Promise<Response>,
): Promise<Response> {
  let status = 503;
  let message = "The demo is temporarily unavailable. Please try again in a minute.";
  try {
    const result = await env.DEMO_TRAFFIC_LIMIT?.limit({ key: "scholarable-demo:dynamic:v1" });
    if (result?.success === true) return next();
    if (result?.success === false) {
      status = 429;
      message = "The demo is busy. Please try again in a minute.";
    }
  } catch { /* Never expose binding errors or fall through to application work. */ }
  const api = new URL(request.url).pathname.startsWith("/api/");
  return new Response(request.method === "HEAD" ? null : api ? JSON.stringify({ error: message }) : message, {
    status,
    headers: {
      "Content-Type": api ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
      "Cache-Control": "no-store", "Retry-After": "60", "Referrer-Policy": "no-referrer",
    },
  });
}
