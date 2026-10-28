import type { DeadlineWatch as DateToWatch } from "../lib/deadline-watch";
import { Link } from "react-router";
import { dateLong, inDays } from "../lib/copy-de";

const dayMonth = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", timeZone: "UTC" });
// "Als Nächstes": the nearest reviewed application dates of saved
// scholarships, the first one big. These are not email reminders.
export function DeadlineWatch({ items, sample = false }: { items: { callId: string; title: string; slug: string; date: DateToWatch }[]; sample?: boolean }) {
  const [first, ...rest] = items;
  return <section className="nextblock" aria-labelledby="deadline-watch-title"><h2 id="deadline-watch-title">Als Nächstes</h2>
    {first ? <>
      <div className="first"><time className="date" dateTime={first.date.date}>{dayMonth.format(new Date(`${first.date.date}T00:00:00Z`))}</time>
        <p>Bewerbungsschluss {inDays(first.date.daysAway)}{first.date.daysAway <= 30 ? " · in den nächsten 30 Tagen" : ""}</p>
        <Link className="lnk" to={`/scholarships/${encodeURIComponent(first.slug)}`}>{first.title}</Link>
        <p className="next-meta">{first.date.scopeDe || first.date.scope} · {first.date.timingDe || first.date.timing}</p></div>
      {rest.length > 0 && <ol className="nextlist">{rest.map(item => <li key={`${item.callId}-${item.date.id}`}>
        <time dateTime={item.date.date}>{dateLong(item.date.date) || item.date.date}</time>
        <div><Link className="lnk" to={`/scholarships/${encodeURIComponent(item.slug)}`}>{item.title}</Link><p>{item.date.scopeDe || item.date.scope} · {inDays(item.date.daysAway)}</p></div>
      </li>)}</ol>}
    </> : <p>Für deine gemerkten Stipendien gibt es gerade keine geprüfte Bewerbungsfrist. Schau auf den Seiten der Anbieter nach.</p>}
    <p className="next-note">{sample ? "Erfundene Daten zum Ausprobieren. " : "Kommende Fristen aus den geprüften Angaben. "}Das sind keine E-Mail-Erinnerungen. Prüf beim Anbieter die aktuelle Frist, die Uhrzeit und für wen sie gilt.</p>
  </section>;
}
