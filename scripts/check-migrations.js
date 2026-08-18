#!/usr/bin/env node
/**
 * Fail if two migrations share the same numeric index (e.g. two branches both
 * adding `0023_*.sql`). That collision doesn't reliably surface from
 * drizzle-kit check — after a merge the journal keeps one index while the other
 * branch's .sql file is orphaned on disk — so guard the filenames directly.
 *
 * Run in CI before migrations are applied; exits non-zero on a duplicate.
 */
const fs = require("fs");
const path = require("path");

// Indices that already carried two migrations before this guard existed. They
// are applied and immutable — renaming them would change drizzle's hashes and
// break every migrated database — so they are grandfathered. The guard's job is
// to stop NEW collisions, not to rewrite history.
const GRANDFATHERED = new Set(["0012", "0013"]);

const dir = path.join(__dirname, "..", "db", "migrations.legacy-neon");
const files = fs
  .readdirSync(dir)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

const byIndex = new Map();
for (const file of files) {
  const index = file.slice(0, 4);
  if (!byIndex.has(index)) byIndex.set(index, []);
  byIndex.get(index).push(file);
}

const duplicates = [...byIndex.entries()].filter(
  ([index, group]) => group.length > 1 && !GRANDFATHERED.has(index)
);

if (duplicates.length > 0) {
  console.error("✖ Duplicate migration indices found:");
  for (const [index, group] of duplicates) {
    console.error(`  ${index}: ${group.join(", ")}`);
  }
  console.error(
    "\nTwo migrations claim the same number. Rebase onto the latest main and\n" +
      "regenerate yours so every migration index is unique."
  );
  process.exit(1);
}

console.log(`✓ ${files.length} migrations, no duplicate indices.`);
