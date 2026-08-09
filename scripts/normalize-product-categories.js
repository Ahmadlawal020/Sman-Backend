#!/usr/bin/env node
/**
 * Collapse product categories onto the short codes: PMS, AGO, LPG.
 *
 * `products.category` and `dangote_products.category` are free-text varchars
 * with nothing constraining them, so the same fuel accumulated several
 * spellings — "PMS", "PMS (Premium Motor Spirit)" and even "Petrol" all meant
 * petrol. Anything grouping by category therefore split one fuel across three
 * rows, and the value is customer-visible: it goes into the ticket email and
 * the public tracking payload, so a buyer saw whichever spelling their product
 * happened to carry.
 *
 * Intended end state, per product:  name = "Petrol",  category = "PMS".
 *
 * Usage:
 *   node scripts/normalize-product-categories.js                # dry run, local
 *   node scripts/normalize-product-categories.js --apply        # write, local
 *   node scripts/normalize-product-categories.js --prod         # dry run, prod
 *   node scripts/normalize-product-categories.js --prod --apply # write, prod
 *
 * Dry run is the default deliberately: this rewrites customer-visible data, so
 * the destructive form has to be typed out. Every --apply run first writes a
 * rollback file containing each row's previous name and category.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");
const PROD = process.argv.includes("--prod");

/**
 * Prefix → canonical code. Matching on the leading token rather than an exact
 * string means a spelling nobody has thought of yet ("PMS - Premium Motor
 * Spirit") still lands correctly, instead of being silently left behind.
 */
const RULES = [
  { code: "PMS", test: (c) => /^pms\b/i.test(c) || /^petrol\b/i.test(c) || /premium motor spirit/i.test(c) },
  { code: "AGO", test: (c) => /^ago\b/i.test(c) || /^diesel\b/i.test(c) || /automotive gas oil/i.test(c) },
  { code: "LPG", test: (c) => /^lpg\b/i.test(c) || /liquefied petroleum gas/i.test(c) || /cooking gas/i.test(c) },
];

const canonical = (category) => {
  const c = String(category || "").trim();
  if (!c) return null;
  return RULES.find((r) => r.test(c))?.code || null;
};

/**
 * The one row where name and category are transposed: name "PMS", category
 * "Petrol". Normalising the category alone would leave name="PMS",
 * category="PMS", which says nothing. The pair is swapped instead so it reads
 * the way every other row does.
 */
const isTransposed = (row) =>
  /^pms$/i.test(String(row.name || "").trim()) && /^petrol$/i.test(String(row.category || "").trim());

const main = async () => {
  const url = PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(`${PROD ? "PROD_DATABASE_URL" : "DATABASE_URL"} is not set`);

  const host = new URL(url).host;
  const sql = postgres(url, {
    connect_timeout: 15,
    max: 2,
    ...(host.startsWith("localhost") || host.startsWith("127.0.0.1") ? {} : { ssl: "require" }),
  });

  console.log(`target : ${PROD ? "PRODUCTION" : "local"} (${host})`);
  console.log(`mode   : ${APPLY ? "APPLY — writes to the database" : "dry run — no writes"}\n`);

  try {
    const products = await sql`SELECT id, name, category FROM products ORDER BY id`;
    const dangote = await sql`SELECT id, name, category FROM dangote_products ORDER BY id`;

    const planned = [];
    const unmapped = [];

    for (const [table, rows] of [
      ["products", products],
      ["dangote_products", dangote],
    ]) {
      for (const row of rows) {
        const swap = isTransposed(row);
        const nextName = swap ? "Petrol" : row.name;
        const nextCategory = swap ? "PMS" : canonical(row.category);

        if (nextCategory === null) {
          unmapped.push({ table, ...row });
          continue;
        }
        if (nextCategory === row.category && nextName === row.name) continue;

        planned.push({ table, id: row.id, from: row, to: { name: nextName, category: nextCategory } });
      }
    }

    if (unmapped.length) {
      console.log("UNMAPPED — left untouched, no rule matched:");
      for (const u of unmapped) console.log(`  ${u.table} #${u.id} category=${JSON.stringify(u.category)}`);
      console.log("");
    }

    if (!planned.length) {
      console.log("Nothing to change — already normalised.");
      return;
    }

    // Grouped, because 100+ identical PMS rows are noise rather than review.
    const summary = new Map();
    for (const p of planned) {
      const key = `${p.table}: ${JSON.stringify(p.from.category)} -> ${JSON.stringify(p.to.category)}${
        p.from.name !== p.to.name ? `  (also name ${JSON.stringify(p.from.name)} -> ${JSON.stringify(p.to.name)})` : ""
      }`;
      summary.set(key, (summary.get(key) || 0) + 1);
    }
    console.log("PLANNED CHANGES:");
    for (const [key, n] of summary) console.log(`  ${String(n).padStart(4)} x  ${key}`);
    console.log(`\n  total rows affected: ${planned.length}`);

    if (!APPLY) {
      console.log("\nDry run — nothing written. Re-run with --apply to commit.");
      return;
    }

    // Rollback snapshot BEFORE any write, so a bad call is recoverable.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rollbackPath = path.join(
      __dirname,
      `rollback-product-categories-${PROD ? "prod" : "local"}-${stamp}.json`
    );
    fs.writeFileSync(
      rollbackPath,
      JSON.stringify(
        planned.map((p) => ({ table: p.table, id: p.id, name: p.from.name, category: p.from.category })),
        null,
        2
      )
    );
    console.log(`\nrollback snapshot: ${rollbackPath}`);

    // One transaction: either every row moves to the new vocabulary or none
    // does. A half-normalised catalogue is worse than an unnormalised one,
    // because reports would look right while quietly under-counting.
    await sql.begin(async (tx) => {
      for (const p of planned) {
        if (p.table === "products") {
          await tx`UPDATE products SET name = ${p.to.name}, category = ${p.to.category}, updated_at = NOW() WHERE id = ${p.id}`;
        } else {
          await tx`UPDATE dangote_products SET name = ${p.to.name}, category = ${p.to.category}, updated_at = NOW() WHERE id = ${p.id}`;
        }
      }
    });

    console.log(`\napplied ${planned.length} row(s).`);

    const after = await sql`
      SELECT category, count(*)::int AS n FROM products GROUP BY category
      UNION ALL
      SELECT category, count(*)::int FROM dangote_products GROUP BY category
      ORDER BY category`;
    console.log("\ncategories now in use:");
    for (const r of after) console.log(`  ${JSON.stringify(r.category).padEnd(10)} x${r.n}`);
  } finally {
    await sql.end();
  }
};

main().catch((err) => {
  console.error("failed:", err.message);
  process.exit(1);
});
