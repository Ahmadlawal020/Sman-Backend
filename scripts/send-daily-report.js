#!/usr/bin/env node
/**
 * Build and send the daily reports.
 *
 *   npm run report:daily                 both reports, for today
 *   npm run report:daily -- --date=2026-08-09
 *   npm run report:daily -- --dry        build the files, send nothing
 *   npm run report:daily -- --to=a@b.com,c@d.com
 *   npm run report:daily -- --only=staff-sales
 *
 * Django ran these from Celery Beat. There is no scheduler in this codebase, so
 * the trigger is deliberately a plain script: cron, a Render job, or a GitHub
 * Action can all call it, and none of them need a broker. If pg-boss ever grows
 * a schedule, it calls exactly the same two functions.
 *
 * Recipients come from REPORT_RECIPIENTS (comma-separated) unless --to is given.
 * With neither set the script refuses rather than silently mailing nobody —
 * Django's equivalent read a ReportRecipient table that was empty on a fresh
 * install, and the reports quietly went nowhere for weeks.
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { notifyAndWait } = require("../notifications");
const { buildDailyReport, buildStaffSalesReport } = require("../services/reportWorkbook.service");
const { client } = require("../db");

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const flag = (name) => process.argv.includes(`--${name}`);

(async () => {
  const dateArg = arg("date");
  const date = dateArg ? new Date(dateArg) : new Date();
  if (Number.isNaN(date.getTime())) {
    console.error(`Not a date: ${dateArg}`);
    process.exit(1);
  }

  const only = arg("only");
  const dry = flag("dry");
  const recipients = (arg("to") || process.env.REPORT_RECIPIENTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!dry && recipients.length === 0) {
    console.error(
      "No recipients. Set REPORT_RECIPIENTS in .env or pass --to=a@b.com.\n" +
        "Refusing to build a report nobody receives."
    );
    process.exit(1);
  }

  const reportDate = date.toISOString().slice(0, 10);
  const jobs = [];
  if (only !== "staff-sales") jobs.push(["reports.daily", buildDailyReport]);
  if (only !== "daily") jobs.push(["reports.daily_staff_sales", buildStaffSalesReport]);

  for (const [type, build] of jobs) {
    const result = await build(date);
    const counts = Object.fromEntries(
      Object.entries(result).filter(([k]) => k.endsWith("Count"))
    );
    console.log(`→ ${result.filename}  (${result.buffer.length.toLocaleString()} bytes)`, counts);

    if (dry) {
      const out = path.join(process.cwd(), result.filename);
      fs.writeFileSync(out, result.buffer);
      console.log(`  written to ${out} — nothing sent (--dry)`);
      continue;
    }

    const res = await notifyAndWait(type, {
      to: recipients.map((email) => ({ email })),
      data: {
        reportDate,
        filename: result.filename,
        attachmentBase64: result.buffer.toString("base64"),
        ...counts,
      },
    });
    console.log(`  sent to ${recipients.join(", ")}`, res?.skipped ? res : "");
  }

  await client.end({ timeout: 5 });
  process.exit(0);
})().catch((err) => {
  console.error("send-daily-report failed:", err);
  process.exit(1);
});
