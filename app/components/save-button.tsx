import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { demoMode } from "../lib/demo-mode";
import { demoProgressChanged, readDemoProgress, removeDemoProgress, saveDemoProgress } from "../lib/demo-progress";
import { BookmarkIcon } from "./icons";

type Variant = "icon" | "wide";
type SaveProps = { callId: string; slug: string; studentAccounts: boolean; signedIn: boolean; saved: boolean; variant?: Variant };

// One click saves a scholarship: signed-in students post straight to their
// list, visitors sign in and come back to this scholarship with it selected,
// and the demo keeps a sample list in this browser only.
export function SaveButton({ callId, slug, studentAccounts, signedIn, saved, variant = "wide" }: SaveProps) {
  if (demoMode) return <DemoSave callId={callId} variant={variant} />;
  if (!studentAccounts) return null;
  if (!signedIn) {
    const href = `/auth/sign-in?returnTo=${encodeURIComponent(`/scholarships/${slug}?save=${callId}`)}`;
    return variant === "icon" ? <Link className="save" to={href} aria-label="Merken, dafür meldest du dich an"><BookmarkIcon /></Link>
      : <Link className="btn line wide" to={href}><BookmarkIcon /><span>Merken</span></Link>;
  }
  return <AccountSave callId={callId} saved={saved} variant={variant} />;
}

function AccountSave({ callId, saved, variant }: { callId: string; saved: boolean; variant: Variant }) {
  const fetcher = useFetcher<{ message?: string; error?: string }>();
  const [isSaved, setIsSaved] = useState(saved);
  const submitted = useRef<string | null>(null);
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message && submitted.current) {
      setIsSaved(submitted.current === "save");
      submitted.current = null;
    }
  }, [fetcher.state, fetcher.data]);
  const label = busy ? "Wird gespeichert…" : isSaved ? "Gemerkt" : "Merken";
  return <fetcher.Form method="post" action="/account" className={`save-form ${variant}`} onSubmit={event => { submitted.current = String(new FormData(event.currentTarget).get("intent")); }}>
    <input type="hidden" name="intent" value={isSaved ? "remove" : "save"} />
    <input type="hidden" name="callId" value={callId} />
    {variant === "icon"
      ? <button className="save" aria-pressed={isSaved} aria-label={isSaved ? "Gemerkt, zum Entfernen tippen" : "Merken"} disabled={busy}><BookmarkIcon filled={isSaved} /></button>
      : <button className="btn line wide" aria-pressed={isSaved} disabled={busy}><BookmarkIcon filled={isSaved} /><span>{label}</span></button>}
    {variant === "wide" && isSaved && !busy && <span className="saved-note">Gemerkt · <Link to="/account">Zu deinen Stipendien</Link></span>}
    {fetcher.data?.error && <span className="form-error" role="alert">{fetcher.data.error}</span>}
  </fetcher.Form>;
}

function DemoSave({ callId, variant }: { callId: string; variant: Variant }) {
  const [ready, setReady] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    try { setIsSaved(readDemoProgress(window.localStorage).some(item => item.id === callId)); } catch { setError(true); }
    setReady(true);
  }, [callId]);
  function toggle() {
    try {
      if (isSaved) removeDemoProgress(window.localStorage, callId); else saveDemoProgress(window.localStorage, callId);
      window.dispatchEvent(new Event(demoProgressChanged));
      setIsSaved(!isSaved); setError(false);
    } catch { setError(true); }
  }
  return <div className={`save-form ${variant}`}>
    {variant === "icon"
      ? <button type="button" className="save" aria-pressed={isSaved} aria-label={isSaved ? "Beispiel gemerkt, zum Entfernen tippen" : "Beispiel merken"} disabled={!ready} onClick={toggle}><BookmarkIcon filled={isSaved} /></button>
      : <button type="button" className="btn line wide" aria-pressed={isSaved} disabled={!ready} onClick={toggle}><BookmarkIcon filled={isSaved} /><span>{isSaved ? "Beispiel gemerkt" : "Beispiel merken"}</span></button>}
    {variant === "wide" && isSaved && <span className="saved-note">Gemerkt · <Link to="/my-plan">Zu deinen Beispielen</Link></span>}
    {error && <span className="form-error" role="alert">Dieser Browser kann keine Beispiele speichern.</span>}
  </div>;
}
