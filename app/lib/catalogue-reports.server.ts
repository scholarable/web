import { demoMode } from "./demo-mode";
import type { CatalogueReport, ReportOutcome } from "./reporting";
import { servingQuery, type ServingEnv } from "./serving.server";

// A 500-character note can percent-encode to several kilobytes; anything past
// this is refused while streaming, before any parsing or allocation beyond it.
export const REPORT_BODY_LIMIT = 8192;

export async function readBoundedForm(request: Request, limit = REPORT_BODY_LIMIT): Promise<URLSearchParams | null> {
  const reader = request.body?.getReader();
  if (!reader) return new URLSearchParams();
  const decoder = new TextDecoder();
  let body = "", size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return null; }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return new URLSearchParams(body);
}

// The database decides: the serving login can only insert through one function
// that re-validates the reference, bounds the note and caps reports per call.
export async function submitCatalogueReport(env: ServingEnv | undefined, report: CatalogueReport): Promise<ReportOutcome> {
  if (demoMode || !env?.SCHOLARABLE_SERVING_DATABASE_URL) return "unavailable";
  try {
    const query = await servingQuery(env);
    await query("select record_catalogue_report($1::bigint, $2, $3, $4)", [report.callId, report.version, report.reason, report.note || null]);
    return "stored";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Too many reports/.test(message)) return "limited";
    if (/invalid report/.test(message)) return "rejected";
    return "unavailable";
  }
}
