import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { PrivacyContent } from "../routes/privacy";

test("privacy notice names current processors and controlled-copy retention without claiming legal completion", () => {
  const html = renderToStaticMarkup(createElement(PrivacyContent));
  for (const text of ["Flamur Maliqi", "Isabella-Braun-Straße 2", "86633 Neuburg an der Donau", "Cloudflare", "Neon PostgreSQL",
    "IONOS", "Gmail", "Bitwarden", "Workers AI", "innerhalb von 30 Tagen nach Abschluss",
    "behauptet nicht, aufgrund einer Vorlage rechtskonform zu sein"]) assert.match(html, new RegExp(text));
  assert.match(html, /Backups und Sicherheitsprotokolle der Anbieter/);
  assert.match(html, /kontospezifische Vertragsnachweise/);
  assert.match(html, /bei Cloudflare betriebenen Auslese- und Prüfschritte/);
  assert.match(html, /schreibt die Originaldatei, den umgewandelten Text und die Anfrage an das Modell weder in einen Objektspeicher noch in eine Datenbank, in Analysen oder in Anwendungsprotokolle/);
  assert.match(html, /Cloudflare Analytics Engine/);
  assert.match(html, /keine Inhalte hochgeladener Dokumente, keinen Gesprächstext, keine OAuth-Tokens, keine Antwortwerte, keine Profilwerte, keine Konto-ID und keine Kennung über Besuche hinweg/);
  assert.doesNotMatch(html, /Cloudflare Access|restricted preview/i);
  assert.match(html, /speichert Scholarable die Meldung in unserer Datenbank/);
  assert.match(html, /Notiz mit bis zu 500 Zeichen und den Zeitpunkt. Name, E-Mail-Adresse oder Konto werden damit nicht verknüpft/);
  assert.match(html, /löschen wir 12 Monate, nachdem das Ergebnis ihrer Prüfung festgehalten ist/);
  assert.match(html, /Bei den erfundenen Beispielen, bei einer Meldung ohne bestimmtes Stipendium oder wenn das Speichern gerade nicht klappt/);
});

test("enabled account notice names WorkOS and does not imply WorkOS identity deletion", () => {
  const html = renderToStaticMarkup(createElement(PrivacyContent, { studentAccounts: true }));
  assert.match(html, /WorkOS/);
  assert.match(html, /in den USA/);
  assert.match(html, /löscht nicht die Identität bei WorkOS/);
  assert.match(html, /Nachweise, wiederverwendbare Geschichten/);
  assert.match(html, /erst wiederverwendet, wenn du sie bestätigst/);
  assert.match(html, /ansehen, korrigieren, herunterladen und löschen/);
});

test("opt-in reminder notice names its recipient lookup and mail processor", () => {
  const html = renderToStaticMarkup(createElement(PrivacyContent, { studentAccounts: true, emailReminders: true }));
  assert.match(html, /schlagen wir deine bestätigte WorkOS-Adresse zum Versandzeitpunkt nach/);
  assert.match(html, /Resend erhält deine E-Mail-Adresse/);
  assert.match(html, /speichert Resend E-Mail-Inhalte, Metadaten, Zustellereignisse und Protokolle 30 Tage lang/);
  assert.match(html, /speichert Kontodaten in den USA, auch wenn aus Irland versendet wird/);
  assert.doesNotMatch(html, /E-Mails von Scholarable sind nicht aktiv/);
});
