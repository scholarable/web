import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import type { AuthPageData } from "../lib/custom-auth.server";

export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" });
export const meta = () => [{ title: "Dein Konto | Scholarable" }];
export default function AuthPage() {
  const loaded = useLoaderData() as AuthPageData;
  const result = useActionData() as AuthPageData | undefined;
  const page = result || loaded;
  const busy = useNavigation().state !== "idle";
  const signup = page.mode === "sign-up";
  const recovery = page.mode === "reset-password";
  const verify = page.step === "verify";
  const newPassword = page.step === "new-password";
  const query = `?returnTo=${encodeURIComponent(page.returnTo)}`;
  const title = verify ? "Schau in dein Postfach" : newPassword ? "Wähl ein neues Passwort" : recovery ? "Passwort zurücksetzen" : signup ? "Konto erstellen" : "Willkommen zurück";
  const description = verify ? `Gib den sechsstelligen Code ein, den wir an ${page.email || "deine E-Mail-Adresse"} geschickt haben.` : newPassword ? "Nimm ein starkes Passwort, das du nirgends sonst benutzt." : recovery ? "Wir schicken dir einen Link, mit dem du ein neues Passwort wählst." : signup ? "Merk dir Stipendien, bau dein Profil auf und hab deine Bewerbungen an einem Ort." : "Melde dich an, um mit deinen gemerkten Stipendien weiterzumachen.";
  const intent = verify ? "verify" : newPassword ? "reset" : recovery ? "forgot" : page.mode;
  return <main className="page-wrap auth-page">
    <div className="auth-intro"><h1>{title}</h1><p className="lede">{description}</p></div>
    <div className="auth-fields">
      {page.error && <p className="form-error" role="alert" id="auth-error">{page.error}</p>}
      {page.message && <p className="auth-message" role="status">{page.message}</p>}
      {!recovery && !verify && <>
        <a className="button auth-google" href={`/auth/other${query}&provider=google${signup ? "&signup=1" : ""}`}>Weiter mit Google</a>
        <div className="auth-divider"><span>oder mit deiner E-Mail-Adresse</span></div>
      </>}
      <Form method="post" className="auth-form" aria-describedby={page.error ? "auth-error" : undefined} key={`${page.mode}-${page.step}`}>
        <input type="hidden" name="intent" value={intent} />
        {verify ? <label>Bestätigungscode aus der E-Mail<input name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoFocus /></label> : <>
          {!newPassword && <label>E-Mail-Adresse<input type="email" name="email" autoComplete="email" maxLength={254} required defaultValue={page.email} /></label>}
          {(!recovery || newPassword) && <label>{newPassword ? "Neues Passwort" : "Passwort"}<input type="password" name="password" autoComplete={signup || newPassword ? "new-password" : "current-password"} minLength={signup || newPassword ? 10 : undefined} maxLength={1024} required />{(signup || newPassword) && <span>Mindestens 10 Zeichen. Keine gängigen oder schon benutzten Passwörter.</span>}</label>}
        </>}
        {!signup && !recovery && !verify && <Link className="auth-forgot" to={`/auth/reset-password${query}`}>Passwort vergessen?</Link>}
        <button className="button" type="submit" disabled={busy}>{busy ? "Bitte warten …" : verify ? "E-Mail bestätigen" : newPassword ? "Passwort ändern" : recovery ? "Link senden" : signup ? "Konto erstellen" : "Anmelden"}</button>
      </Form>
      {verify && <Form method="post"><input type="hidden" name="intent" value="restart" /><button className="auth-text-button" disabled={busy}>Neu anfangen oder andere E-Mail nutzen</button></Form>}
      {recovery ? <p className="auth-switch"><Link to={`/auth/sign-in${query}`}>Zurück zur Anmeldung</Link></p> : <>
        <p className="auth-switch">{signup ? "Schon ein Konto?" : "Neu bei Scholarable?"} <Link to={`/auth/${signup ? "sign-in" : "sign-up"}${query}`}>{signup ? "Anmelden" : "Konto erstellen"}</Link></p>
        <Link className="auth-other" to={`/auth/other${query}`}>Andere Anmeldemöglichkeiten</Link>
      </>}
      {signup && <p className="auth-note">Dein gespeichertes Profil und deine Bewerbungen sind privat. <Link to="/privacy">So gehen wir mit deinen Daten um</Link>.</p>}
      <p className="auth-note"><Link to="/">Ohne Konto weiter Stipendien suchen</Link></p>
    </div>
  </main>;
}
