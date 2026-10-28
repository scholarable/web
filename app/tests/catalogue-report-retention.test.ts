import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deleteHandledReports } from "../lib/catalogue-report-retention.server";

test("the daily job deletes handled reports through the email worker login", async () => {
  const calls: { url: string; sql?: string; values?: unknown[] }[] = [];
  const removed = await deleteHandledReports({ SCHOLARABLE_EMAIL_DATABASE_URL: "synthetic-email-boundary" }, async url => {
    calls.push({ url });
    return async (sql: string, values: unknown[]) => { calls.push({ url, sql, values }); return [{ removed: 3 }]; };
  });
  assert.equal(removed, 3);
  assert.deepEqual(calls, [
    { url: "synthetic-email-boundary" },
    { url: "synthetic-email-boundary", sql: "select delete_handled_catalogue_reports() as removed", values: [] },
  ]);
});

test("a missing connection fails loudly instead of keeping reports forever", async () => {
  await assert.rejects(deleteHandledReports({}, async () => { throw new Error("must not connect"); }), /Report retention database unavailable/);
});

test("the scheduled Worker handler runs the report deletion every day", async () => {
  const worker = await readFile(new URL("../../workers/app.ts", import.meta.url), "utf8");
  assert.match(worker, /scheduled\([^)]*\)\s*\{\s*await Promise\.all\(\[[^\]]*deleteHandledReports\(env\)/);
});
