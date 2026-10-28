import { data, Form, useActionData, useLoaderData } from "react-router";
import type { Route } from "./+types/email-unsubscribe";
import { emailPreferencesReady, unsubscribeStudentEmail, verifyUnsubscribeToken, type EmailEnv } from "../lib/email.server";
import { studentAuthEnv } from "../lib/student-auth.server";

export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" });
export const meta = () => [{ title: "E-Mails abbestellen | Scholarable" }];

function token(request: Request) {
  const value = new URL(request.url).searchParams.get("token") || "";
  if (!value || value.length > 500) throw new Response("Invalid unsubscribe link", { status: 400 });
  return value;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = studentAuthEnv(context) as EmailEnv;
  if (!emailPreferencesReady(env)) throw new Response("Email preferences are unavailable", { status: 503 });
  try {
    const preference = await verifyUnsubscribeToken(token(request), env.SCHOLARABLE_EMAIL_UNSUBSCRIBE_KEY!);
    return { category: preference.category, token: token(request) };
  } catch { throw new Response("Invalid unsubscribe link", { status: 400 }); }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = studentAuthEnv(context) as EmailEnv;
  if (request.method !== "POST") throw new Response("Method not allowed", { status: 405 });
  if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) throw new Response("Form encoding required", { status: 415 });
  const body = await request.text();
  if (body.length > 1000) throw new Response("Form too large", { status: 413 });
  const value = new URLSearchParams(body).get("token") || token(request);
  try {
    const category = await unsubscribeStudentEmail(env, value);
    return data({ category, stopped: true });
  } catch { return data({ error: "Dieser Abmeldelink ist ungültig oder nicht mehr verfügbar." }, { status: 400 }); }
}

export default function EmailUnsubscribe() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const category = result && "category" in result ? result.category : loaded.category;
  const label = category === "reminders" ? "Erinnerungen an Fristen deiner gemerkten Stipendien" : "persönlichen Stipendien-E-Mails";
  return <main className="page-wrap"><h1>E-Mail-Einstellungen</h1>
    {result && "stopped" in result && result.stopped ? <p role="status">Du bekommst keine {label} mehr.</p> : <>
      {result && "error" in result && <p className="form-error" role="alert">{result.error}</p>}
      <p>Keine {label} mehr bekommen? Deine anderen E-Mail-Einstellungen bleiben, wie sie sind.</p>
      <Form method="post" action={`/email/unsubscribe?token=${encodeURIComponent(loaded.token)}`}><input type="hidden" name="token" value={loaded.token} /><button className="btn dark">Diese E-Mails abbestellen</button></Form>
    </>}
  </main>;
}
