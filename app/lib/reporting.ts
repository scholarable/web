export const SUPPORT_EMAIL = "info@scholarable.de";
export const REPORT_REASONS = {
  stale: "Angaben wirken veraltet",
  incorrect: "Angaben wirken falsch",
  link: "Offizieller Link funktioniert nicht",
  other: "Anderes Problem in der Liste",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;
export type ReportReference = { callId: string; version: string | null };

// These exact identifiers belong to fictional bundled examples, not the review desk.
export function isSampleReference(callId: string): boolean {
  return ["demo-bachelor", "demo-master", "demo-doctoral", "demo-exchange"].includes(callId);
}

export function reportReference(callId: unknown, version: unknown): ReportReference | null {
  if (typeof callId !== "string" || (!/^[1-9][0-9]{0,17}$/.test(callId) && !isSampleReference(callId))) return null;
  // Only a public verification timestamp, never arbitrary query/profile text.
  const checked = typeof version === "string" && version.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(version) &&
    Number.isFinite(Date.parse(version)) ? version : null;
  return { callId, version: isSampleReference(callId) ? null : checked };
}

export function reportHref(reference: ReportReference): string {
  const safe = reportReference(reference.callId, reference.version);
  if (!safe) return "/report";
  const params = new URLSearchParams({ call: safe.callId });
  if (safe.version) params.set("version", safe.version);
  return `/report?${params}`;
}

export const REPORT_NOTE_LIMIT = 500;
export type CatalogueReport = { callId: string; version: string | null; reason: ReportReason; note: string };
export type ReportOutcome = "stored" | "rejected" | "limited" | "unavailable";

// Only a bounded public reference, a fixed reason and a short free-text note.
// Fictional samples are never stored; they keep the email path.
export function parseCatalogueReport(form: URLSearchParams): CatalogueReport | null {
  const reference = reportReference(form.get("call"), form.get("version"));
  if (!reference || isSampleReference(reference.callId)) return null;
  const reason = form.get("reason") || "";
  if (!Object.hasOwn(REPORT_REASONS, reason)) return null;
  const note = (form.get("note") || "").replace(/\r\n?/g, "\n").trim();
  if (note.length > REPORT_NOTE_LIMIT || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(note)) return null;
  return { callId: reference.callId, version: reference.version, reason: reason as ReportReason, note };
}

export function reportDraft(reference: ReportReference | null, reason: ReportReason): string {
  if (!Object.hasOwn(REPORT_REASONS, reason)) throw new Error("Wähl einen Grund für die Meldung");
  const safe = reference && reportReference(reference.callId, reference.version);
  const body = [
    REPORT_REASONS[reason],
    `Stipendium: ${safe?.callId ?? "nicht angegeben"}`,
    ...(safe && isSampleReference(safe.callId) ? ["Erfundenes Beispiel – Rückmeldung zur Seite, keine Meldung zu einem geprüften Stipendium."] : []),
    `Öffentlicher Prüfzeitpunkt: ${safe?.version ?? "nicht verfügbar"}`,
    "",
    "Bitte beschreib, was nicht stimmt, und nenn wenn möglich die offizielle Quelle.",
    "Bitte keine Profilangaben, Angaben zu Geld oder Gesundheit, Passwörter oder Lebensläufe.",
  ].join("\n");
  // The subject keeps its English start so existing mail filters still match.
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Scholarable catalogue report – Fehler in einem Stipendium")}&body=${encodeURIComponent(body)}`;
}
