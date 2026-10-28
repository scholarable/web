import { emailDatabaseQuery, type EmailEnv } from "./email.server";
import type { StudentDataQuery } from "./student-progress.server";

// Saved catalogue reports are deleted 12 months after they were handled (owner
// decision 2026-10-23; the privacy page promises it). The daily job runs the
// database function through the dedicated email worker login. It has no switch:
// a missing connection fails the job loudly instead of keeping reports forever.
export async function deleteHandledReports(env: Pick<EmailEnv, "SCHOLARABLE_EMAIL_DATABASE_URL">,
  connect: (url: string) => Promise<StudentDataQuery> = emailDatabaseQuery): Promise<number> {
  if (!env.SCHOLARABLE_EMAIL_DATABASE_URL) throw new Error("Report retention database unavailable");
  const query = await connect(env.SCHOLARABLE_EMAIL_DATABASE_URL);
  const rows = await query("select delete_handled_catalogue_reports() as removed", []);
  return Number(rows[0]?.removed ?? 0);
}
