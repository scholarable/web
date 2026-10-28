import { authkitLoader } from "@workos-inc/authkit-react-router";
import { data, Link, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/document-library";
import { requireSameOriginPost, requireStudentAuth, studentAuthEnv, studentConnection } from "../lib/student-auth.server";
import { boundedDocumentForm, changeDocument, documentCategories, documentEnv, documentPilotAllowed, readDocuments, saveDocument } from "../lib/student-documents.server";
import { readStudentApplicationWorkspaces, readStudentProgress } from "../lib/student-progress.server";
import type { PrivateDocument } from "../lib/student-documents.server";
import { dateLong } from "../lib/copy-de";
import { messageDe } from "../lib/messages-de";

const categoryDe: Record<string, string> = { cv: "Lebenslauf", transcript: "Notenübersicht", certificate: "Zeugnis oder Zertifikat", recommendation: "Empfehlungsschreiben" };

export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
export const meta = () => [{ title: "Meine Dokumente | Scholarable" }];

export async function loader(args: Route.LoaderArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context));
  return authkitLoader(args, async ({ auth, getAccessToken }) => {
    if (!auth.user.emailVerified || auth.impersonator) throw new Response("Verified student account required", { status: 403 });
    const enabled = documentEnv(args.context).SCHOLARABLE_DOCUMENTS_ENABLED === "true";
    if (!enabled) return data<{ enabled: boolean; canUpload: boolean; documents: PrivateDocument[]; applications: string[]; categories: readonly string[] }>({ enabled, canUpload: false, documents: [], applications: [], categories: documentCategories });
    const { query, digest } = await studentConnection(args.context, auth.user.id, getAccessToken());
    const [documents, workspaces, progress] = await Promise.all([readDocuments(query, digest), readStudentApplicationWorkspaces(query, digest), readStudentProgress(query, digest)]);
    const saved = new Set(progress.opportunities.filter(item => item.disposition === "saved").map(item => String(item.call_id)));
    return data({ enabled, canUpload: documentPilotAllowed(documentEnv(args.context), digest), documents, applications: workspaces.map(item => String(item.call_id)).filter(call => saved.has(call)), categories: documentCategories });
  }, { ensureSignedIn: true });
}

export async function action(args: Route.ActionArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context)); requireSameOriginPost(args.request);
  return authkitLoader(args, async ({ auth, getAccessToken }) => {
    if (!auth.user.emailVerified || auth.impersonator) throw new Response("Verified student account required", { status: 403 });
    const env = documentEnv(args.context);
    if (env.SCHOLARABLE_DOCUMENTS_ENABLED !== "true") throw new Response("Document library unavailable", { status: 503 });
    try {
      const { query, digest } = await studentConnection(args.context, auth.user.id, getAccessToken());
      const form = await boundedDocumentForm(args.request);
      if (form.get("intent") === "upload") await saveDocument(query, digest, env, form);
      else await changeDocument(query, digest, form);
      return data({ message: "Dokumente gespeichert.", error: "" });
    } catch (error) {
      if (error instanceof Response) return data({ error: messageDe(await error.text(), "Das hat nicht geklappt. Prüf die Datei und versuch es noch einmal."), message: "" }, { status: error.status });
      if (error instanceof Error && /changed|reload/i.test(error.message)) return data({ error: "Dieses Dokument hat sich geändert. Lade die Seite neu und versuch es noch einmal.", message: "" }, { status: 409 });
      if (error instanceof Error && /Document (storage |version )?limit reached/.test(error.message)) return data({ error: "Dein Speicherplatz für Dokumente ist voll. Lösch ein Dokument und seine früheren Versionen, bevor du mehr hochlädst.", message: "" }, { status: 400 });
      if (error instanceof Error && /Document version not available|Choose a future document review date/.test(error.message)) return data({ error: "Diese Version gibt es nicht mehr, oder das Prüfdatum liegt nicht in der Zukunft. Lade die Seite neu und prüf das Datum.", message: "" }, { status: 400 });
      return data({ error: "Die Dokumente ließen sich gerade nicht ändern. Versuch es noch einmal.", message: "" }, { status: 503 });
    }
  }, { ensureSignedIn: true });
}

export default function DocumentLibrary() {
  const { enabled, canUpload, documents, applications, categories } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>(); const busy = fetcher.state !== "idle";
  return <main className="page-wrap account-page"><p><Link to="/account">← Gemerkt</Link></p><h1>Meine Dokumente</h1>
    {!enabled ? <p>Der private Dokumentenspeicher wird noch vorbereitet. Die Dokumentenliste in jedem Arbeitsbereich kannst du trotzdem nutzen.</p> : <>
      <p>Bewahre private PDF-Kopien deines Lebenslaufs, deiner Notenübersichten, Zeugnisse und Empfehlungsschreiben auf. Bis zu 20 Dokumente, 100 gespeicherte Versionen pro Dokument, 5 MB pro Datei und insgesamt 50 MB einschließlich früherer Versionen. Ausweisdokumente werden nicht unterstützt.</p>
      <p>Dateien werden auf Sicherheit geprüft und verschlüsselt. Sie werden nicht von einer KI verarbeitet und nicht an Stipendiengeber geschickt. Du kannst alle Kopien und Verknüpfungen hier löschen oder zusammen mit deinen gespeicherten Kontodaten.</p>
      <p>Prüf die Speicherung an deinem eingetragenen Prüfdatum oder nach 24 Monaten ohne Kontoaktivität. Abgelaufene oder ersetzte Versionen kannst du innerhalb von 29 Tagen verlängern; sie werden innerhalb von 30 Tagen aus dem aktiven Speicher entfernt, außer du bestätigst ausdrücklich einen fortbestehenden Zweck. Eine Datei nur zu öffnen oder herunterzuladen verlängert diesen Zweck nicht. Sicherungskopien laufen nach dem Sicherungsplan der Datenbank ab, der geprüft sein muss, bevor diese Bibliothek eingeschaltet wird.</p>
      {fetcher.data?.error && <p role="alert" className="form-error">{fetcher.data.error}</p>}{fetcher.data?.message && <p role="status">{fetcher.data.message}</p>}
      {!canUpload && <p>Neue Dateien hochladen können nur eingeladene Pilotkonten. Deine gespeicherten Dokumente kannst du trotzdem verwalten und löschen.</p>}
      {canUpload && <fetcher.Form method="post" encType="multipart/form-data"><input type="hidden" name="intent" value="upload" />
        <label>Art des Dokuments<select name="category">{categories.map(category => <option key={category} value={category}>{categoryDe[category] || category}</option>)}</select></label>
        <label>PDF-Datei<input type="file" name="file" accept="application/pdf,.pdf" required /></label>
        <label>Prüf- oder Ablaufdatum (optional)<input type="date" name="review_on" /></label>
        <label><input type="checkbox" name="consent" value="yes" required />Ich stimme zu, diese Datei in meiner privaten Dokumentenbibliothek zu speichern.</label><button disabled={busy}>Dokument speichern</button>
      </fetcher.Form>}
      {documents.length === 0 && <p>Noch keine Dokumente gespeichert.</p>}
      {documents.map(document => <article className="result-card" key={document.id}><h2>{document.name}</h2>
        <p>{categoryDe[document.category] || document.category} · Version {document.latest_version} · {Math.ceil(document.size / 1024)} KB{document.review_on ? ` · prüfen bis ${dateLong(document.review_on)}` : ""}</p>
        {document.review_due && <p role="status">Prüf, ob du dieses Dokument weiter brauchst. Abgelaufene Versionen werden innerhalb von 30 Tagen nach ihrem eingetragenen Prüfdatum entfernt, außer du verlängerst sie.</p>}
        <p>Lade eine Kopie herunter und lade sie dann selbst über den offiziellen Bewerbungsweg des Anbieters hoch.</p>
        {document.versions.map(version => <div key={version.version}><p><Link reloadDocument className="text-link" to={`/account/documents/${document.id}/download/${version.version}`}>Version {version.version} herunterladen</Link>{version.review_on ? ` · prüfen bis ${dateLong(version.review_on)}` : ""}{version.replaced_at ? " · ersetzt; wird innerhalb von 30 Tagen entfernt, außer du verlängerst sie" : ""}{version.review_due ? " · Prüfung nötig" : ""}</p>
          <details><summary>Weitere Speicherung von Version {version.version} bestätigen</summary><fetcher.Form method="post" encType="multipart/form-data"><input type="hidden" name="intent" value="renew" /><input type="hidden" name="documentId" value={document.id} /><input type="hidden" name="version" value={version.version} />
            <label>Nächstes Prüfdatum (optional)<input type="date" name="review_on" /></label><label><input type="checkbox" name="consent" value="yes" required />Ich brauche diese Version noch und bestätige, dass sie weiter privat gespeichert wird. Das bestätigt nicht, dass das Dokument für eine Bewerbung gültig ist.</label><button disabled={busy}>Diese Version behalten</button>
          </fetcher.Form></details></div>)}
        {canUpload && <details><summary>Durch eine neue Version ersetzen</summary><fetcher.Form method="post" encType="multipart/form-data">
          <input type="hidden" name="intent" value="upload" /><input type="hidden" name="documentId" value={document.id} /><input type="hidden" name="version" value={document.version} /><input type="hidden" name="category" value={document.category} />
          <label>PDF-Datei<input type="file" name="file" accept="application/pdf,.pdf" required /></label><label>Prüfdatum<input type="date" name="review_on" defaultValue={document.review_on || ""} /></label>
          <label><input type="checkbox" name="consent" value="yes" required />Die neue Version speichern. Frühere Versionen werden innerhalb von 30 Tagen entfernt, außer ich bestätige ihren weiteren Zweck gesondert.</label><button disabled={busy}>Dokument ersetzen</button>
        </fetcher.Form></details>}
        <details><summary>Mit einer Bewerbung verknüpfen</summary>{applications.length ? <fetcher.Form method="post" encType="multipart/form-data"><input type="hidden" name="intent" value="link" /><input type="hidden" name="documentId" value={document.id} /><label>Gemerkte Bewerbung<select name="callId">{applications.map(call => <option key={call} value={call}>Bewerbung {call}</option>)}</select></label><button disabled={busy}>Dokument verknüpfen</button></fetcher.Form> : <p>Merk dir zuerst ein Stipendium.</p>}
          {document.links.map(call => <fetcher.Form key={call} method="post" encType="multipart/form-data"><input type="hidden" name="intent" value="unlink" /><input type="hidden" name="documentId" value={document.id} /><input type="hidden" name="callId" value={call} /><Link to={`/account/applications/${call}`}>Bewerbung {call}</Link> <button className="text-button" disabled={busy}>Verknüpfung lösen</button></fetcher.Form>)}
        </details>
        <fetcher.Form method="post" encType="multipart/form-data"><input type="hidden" name="intent" value="delete" /><input type="hidden" name="documentId" value={document.id} /><label>Gib DELETE ein, um alle Versionen und Verknüpfungen zu löschen<input name="confirm" autoComplete="off" required /></label><button disabled={busy}>Dokument löschen</button></fetcher.Form>
      </article>)}
    </>}
  </main>;
}
