#!/usr/bin/env node
/**
 * Set a staff password directly, on whichever database you point it at.
 *
 *   node scripts/set-staff-password.js --email=you@x.com --password='NewPass123!'          (local)
 *   node scripts/set-staff-password.js --email=you@x.com --password='NewPass123!' --prod   (production)
 *
 * This exists so recovering an account never depends on email delivery working.
 * After the migration nobody knows the legacy password hashes, and if Resend is
 * misconfigured the "forgot password" route is a dead end — which would leave
 * the system with no way in at all.
 *
 * It refuses to create accounts. If the email is not already on the staff table
 * it stops, because a typo that silently created a brand-new super-admin would
 * be considerably worse than an error message.
 */
require("dotenv").config();
const postgres = require("postgres");
const bcrypt = require("bcrypt");

const arg = (n) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};

(async () => {
  const email = (arg("email") || "").trim().toLowerCase();
  const password = arg("password") || "";
  const useProd = process.argv.includes("--prod");

  if (!email || !password) {
    console.error("Usage: --email=you@example.com --password='NewPass123!' [--prod]");
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("Refusing: use at least 10 characters.");
    process.exit(1);
  }

  let url = useProd ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) {
    console.error(useProd ? "PROD_DATABASE_URL is not set." : "DATABASE_URL is not set.");
    process.exit(1);
  }
  // Neon's pooler is fine for a single UPDATE; the CA bundle is not implied.
  if (useProd && !/sslrootcert=/.test(url)) url += (url.includes("?") ? "&" : "?") + "sslrootcert=system";

  const target = useProd ? "PRODUCTION" : "local";
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    const [existing] = await sql`SELECT id, email, roles FROM staff WHERE lower(email) = ${email}`;
    if (!existing) {
      console.error(`No staff account with email "${email}" on ${target}. Nothing changed.`);
      process.exit(1);
    }

    const hash = await bcrypt.hash(password, 12);
    const [row] = await sql`
      UPDATE staff
         SET password = ${hash}, is_password_set = true, is_active = true, suspended = false
       WHERE id = ${existing.id}
      RETURNING id, email, roles`;

    console.log(`✓ ${target}: password set for ${row.email} (id ${row.id}, roles ${JSON.stringify(row.roles)})`);
    console.log("  You can sign in with it now.");
  } finally {
    await sql.end({ timeout: 5 });
  }
})().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
