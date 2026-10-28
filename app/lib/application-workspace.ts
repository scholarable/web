import { applicationGuide, type ApplicationGuideData } from "./application-guide";

export type WorkspaceDraft = {
  question_id: string;
  answer: string;
  state: "not_started" | "drafting" | "ready_for_review" | "approved";
  version: number;
  updated_at: string;
};
export type WorkspaceDocument = {
  document_id: string;
  state: "not_started" | "ready" | "not_applicable";
  version: number;
  updated_at: string | null;
};
export type ArchivedDraft = Omit<WorkspaceDraft, "question_id"> & {
  packet_version: string;
  question: { id: string; prompt: string } & Record<string, unknown>;
};
export type ArchivedDocument = Omit<WorkspaceDocument, "document_id"> & {
  packet_version: string;
  document: { id: string; name: string } & Record<string, unknown>;
};
export type SubmissionSnapshot = {
  id: string;
  packet_version: string;
  packet: ApplicationGuideData;
  approved_answers: Record<string, unknown>[];
  checklist: Record<string, unknown>[];
  submitted_at: string;
};
export type ApplicationWorkspaceData = {
  call_id: string;
  packet_version: string;
  packet: ApplicationGuideData;
  current_packet: ApplicationGuideData | null;
  packet_status: "current" | "changed" | "unavailable";
  deadline_status: "current" | "expired" | "unknown";
  selected_track_id: string | null;
  selected_route_id: string | null;
  note: string;
  version: number;
  created_at: string;
  updated_at: string;
  drafts: WorkspaceDraft[];
  archived_drafts: ArchivedDraft[];
  checklist: WorkspaceDocument[];
  archived_checklist: ArchivedDocument[];
  submissions: SubmissionSnapshot[];
};

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown) => typeof value === "string" && /^[1-9][0-9]{0,17}$/.test(value);
const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max;
const version = (value: unknown, allowZero = false) => typeof value === "number" && Number.isSafeInteger(value)
  && value >= (allowZero ? 0 : 1);

// Treat the private function as a trust boundary too: malformed packet or
// student data fails closed instead of rendering a partial application.
export function applicationWorkspace(value: unknown): ApplicationWorkspaceData | null {
  if (!record(value) || !id(value.call_id) || !text(value.packet_version, 500)
    || !["current", "changed", "unavailable"].includes(String(value.packet_status))
    || !["current", "expired", "unknown"].includes(String(value.deadline_status))
    || !(value.selected_track_id == null || text(value.selected_track_id, 100))
    || !(value.selected_route_id == null || text(value.selected_route_id, 100))
    || !text(value.note, 20000) || !version(value.version)
    || !text(value.created_at, 100) || !text(value.updated_at, 100)
    || !Array.isArray(value.drafts) || !Array.isArray(value.archived_drafts)
    || !Array.isArray(value.checklist) || !Array.isArray(value.archived_checklist) || !Array.isArray(value.submissions)
    || value.drafts.length > 100 || value.checklist.length > 100 || value.archived_drafts.length > 1000
    || value.archived_checklist.length > 1000 || value.submissions.length > 100) return null;
  const packet = applicationGuide(value.packet);
  const currentPacket = value.current_packet == null ? null : applicationGuide(value.current_packet);
  if (!packet || packet.packet_version !== value.packet_version || (value.current_packet != null && !currentPacket)
    || (value.packet_status === "current" && currentPacket?.packet_version !== packet.packet_version)
    || (value.packet_status === "changed" && (!currentPacket || currentPacket.packet_version === packet.packet_version))
    || (value.packet_status === "unavailable" && currentPacket)) return null;
  const selectedRoute = packet.routes.find(route => route.id === value.selected_route_id);
  if (value.selected_route_id != null && (!selectedRoute || selectedRoute.availability_status !== "available"
    || (selectedRoute.track_id != null && selectedRoute.track_id !== value.selected_track_id))) return null;
  const questionIds = new Set(packet.questions.map((question) => question.id));
  const documentIds = new Set(packet.documents.map((document) => document.id));
  const drafts: WorkspaceDraft[] = [];
  for (const draft of value.drafts) {
    if (!record(draft) || typeof draft.question_id !== "string" || !questionIds.has(draft.question_id)
      || !text(draft.answer, 20000) || !["not_started", "drafting", "ready_for_review", "approved"].includes(String(draft.state))
      || !version(draft.version) || !text(draft.updated_at, 100)) return null;
    drafts.push(draft as WorkspaceDraft);
  }
  const checklist: WorkspaceDocument[] = [];
  for (const item of value.checklist) {
    if (!record(item) || typeof item.document_id !== "string" || !documentIds.has(item.document_id)
      || !["not_started", "ready", "not_applicable"].includes(String(item.state)) || !version(item.version, true)
      || !(item.updated_at == null || text(item.updated_at, 100))) return null;
    checklist.push(item as WorkspaceDocument);
  }
  const archivedDrafts: ArchivedDraft[] = [];
  for (const draft of value.archived_drafts) {
    if (!record(draft) || !text(draft.packet_version, 500) || !record(draft.question)
      || !text(draft.question.id, 100) || !text(draft.question.prompt, 4000)
      || !text(draft.answer, 20000) || !["not_started", "drafting", "ready_for_review", "approved"].includes(String(draft.state))
      || !version(draft.version) || !text(draft.updated_at, 100)) return null;
    archivedDrafts.push(draft as ArchivedDraft);
  }
  const archivedChecklist: ArchivedDocument[] = [];
  for (const item of value.archived_checklist) {
    if (!record(item) || !text(item.packet_version, 500) || !record(item.document)
      || !text(item.document.id, 100) || !text(item.document.name, 500)
      || !["not_started", "ready", "not_applicable"].includes(String(item.state))
      || !version(item.version) || !text(item.updated_at, 100)) return null;
    archivedChecklist.push(item as ArchivedDocument);
  }
  const submissions: SubmissionSnapshot[] = [];
  for (const snapshot of value.submissions) {
    if (!record(snapshot) || !id(snapshot.id) || !text(snapshot.packet_version, 500)
      || !Array.isArray(snapshot.approved_answers) || !Array.isArray(snapshot.checklist)
      || snapshot.approved_answers.length > 100 || snapshot.checklist.length > 100
      || !snapshot.approved_answers.every(record) || !snapshot.checklist.every(record)
      || !text(snapshot.submitted_at, 100)) return null;
    const snapshotPacket = applicationGuide(snapshot.packet);
    if (!snapshotPacket || snapshotPacket.packet_version !== snapshot.packet_version) return null;
    submissions.push({ ...snapshot, packet: snapshotPacket } as SubmissionSnapshot);
  }
  return { call_id: value.call_id as string, packet_version: value.packet_version as string, packet,
    current_packet: currentPacket, packet_status: value.packet_status as ApplicationWorkspaceData["packet_status"],
    deadline_status: value.deadline_status as ApplicationWorkspaceData["deadline_status"],
    selected_track_id: value.selected_track_id as string | null, selected_route_id: value.selected_route_id as string | null,
    note: value.note as string, version: value.version as number, created_at: value.created_at as string,
    updated_at: value.updated_at as string, drafts, archived_drafts: archivedDrafts,
    checklist, archived_checklist: archivedChecklist, submissions };
}
