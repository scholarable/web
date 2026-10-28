import { demoMode, publicDemoMode } from "./lib/demo-mode";
import { demoProgressChanged, readDemoProgress } from "./lib/demo-progress";
import { studentAuthEnv, studentAuthReady } from "./lib/student-auth.server";
import { remindersReady, type ReminderEnv } from "./lib/email-reminders.server";
import { emailReady, type EmailEnv } from "./lib/email.server";
import { chatAiReady, type ChatEnv } from "./lib/chat-understanding.server";
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useRevalidator,
  useRouteLoaderData,
} from "react-router";
import { useEffect, useState } from "react";
import type { Route } from "./+types/root";
import { BookmarkIcon, LogoMark } from "./components/icons";
import "./styles.css";

export function meta() {
  return [{ title: "Scholarable | Stipendien, klar erklärt" }];
}

export function loader({ request, context }: Route.LoaderArgs) {
  return { studentAccounts: studentAuthReady(request, studentAuthEnv(context)),
    studentEmails: emailReady(studentAuthEnv(context) as EmailEnv),
    emailReminders: remindersReady(studentAuthEnv(context) as ReminderEnv),
    chatAi: chatAiReady((context as { cloudflare?: { env?: object } }).cloudflare?.env as ChatEnv | undefined) };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const root = useRouteLoaderData<typeof loader>("root");
  const { pathname } = useLocation();
  const chatPage = pathname === "/" || pathname === "/match";
  const [hasSavedPlan, setHasSavedPlan] = useState(false);
  useEffect(() => {
    if (!demoMode) return;
    const updatePlan = () => {
      try { setHasSavedPlan(readDemoProgress(window.localStorage).length > 0); }
      catch { setHasSavedPlan(false); }
    };
    updatePlan();
    window.addEventListener(demoProgressChanged, updatePlan);
    window.addEventListener("storage", updatePlan);
    window.addEventListener("pageshow", updatePlan);
    return () => {
      window.removeEventListener(demoProgressChanged, updatePlan);
      window.removeEventListener("storage", updatePlan);
      window.removeEventListener("pageshow", updatePlan);
    };
  }, []);
  const current = (path: string) => pathname === path ? "page" as const : undefined;
  return (
    <html lang="de">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/bricolage-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="icon" type="image/svg+xml" href="/scholarable-mark.svg" />
        <Meta />
        <Links />
      </head>
      <body className={chatPage ? "discover-shell" : undefined}>
        <a className="skip-link" href="#main-content">Zum Inhalt springen</a>
        {/* data-build is the sample-build marker scripts/demo_preflight.mjs looks for before a demo deploy. */}
        {publicDemoMode && <aside className="demo-banner" role="note" data-build="Demo — sample data"><strong>Demo mit erfundenen Daten</strong><span>Vier erfundene Stipendien zum Ausprobieren. Bewerben kannst du dich hier nirgends.</span></aside>}
        <header className="site-header">
          {/* Links inside the app, so the chat's answers (tab memory) stay between the chat and the list. */}
          <Link className="wordmark" to="/" aria-label="Scholarable, zur Startseite"><LogoMark /><span>Scholarable</span></Link>
          <nav className="site-nav" aria-label="Hauptnavigation">
            <Link className="nav-list" to="/scholarships" aria-current={current("/scholarships")}>Stipendien</Link>
            {demoMode && hasSavedPlan && <a href="/my-plan" aria-current={current("/my-plan")}><BookmarkIcon /><span>Gemerkt</span></a>}
            {!demoMode && root?.studentAccounts && <><a className="nav-profile" href="/profile" aria-current={current("/profile")}>Profil</a><a href="/account" aria-current={current("/account")}><BookmarkIcon /><span>Gemerkt</span></a></>}
          </nav>
        </header>
        <div id="main-content" tabIndex={-1}>{children}</div>
        <footer className="site-footer">
          <div><strong>Scholarable</strong><span>Kostenlos für Studierende in Deutschland. Maßgeblich bleibt die Seite des Anbieters.</span></div>
          <nav aria-label="Weitere Links">{chatPage && <a href="/match?mode=form">Lieber ein Formular</a>}<a href="/privacy">Datenschutz und Kontakt</a><a href="/report">Fehler melden</a></nav>
        </footer>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { revalidate } = useRevalidator();
  useEffect(() => {
    // A restored browser page must consult the serving views again.
    const restore = (event: PageTransitionEvent) => { if (event.persisted) void revalidate(); };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, [revalidate]);
  return <Outlet />;
}

// Every error page is German and never shows the technical message behind it.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const [title, text] = status === 404 ? ["Diese Seite gibt es nicht", "Vielleicht hat sich die Adresse geändert. Auf der Startseite findest du alle Stipendien."]
    : status === 403 ? ["Dafür musst du angemeldet sein", "Melde dich mit einem bestätigten Konto an und versuch es noch einmal."]
    : status === 413 ? ["Das war zu viel auf einmal", "Kürz deine Eingabe und versuch es noch einmal."]
    : status === 429 ? ["Gerade zu viele Anfragen", "Warte kurz und versuch es dann noch einmal."]
    : status === 503 ? ["Gerade nicht erreichbar", "Dieser Teil von Scholarable ist im Moment nicht verfügbar. Versuch es später noch einmal."]
    : status >= 400 && status < 500 ? ["Das hat nicht geklappt", "Bitte prüf deine Eingabe und versuch es noch einmal."]
    : ["Da ist etwas schiefgelaufen", "Bitte lade die Seite neu oder versuch es später noch einmal."];
  return <main className="page-wrap"><section className="notice" role="alert"><h1>{title}</h1><p>{text}</p><p><a className="btn link" href="/">Zur Startseite</a></p></section></main>;
}

export function headers(_: Route.HeadersArgs) {
  return { "Cache-Control": "no-store" };
}
