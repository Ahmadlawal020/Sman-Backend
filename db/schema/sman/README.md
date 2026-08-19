# sman schema

Tables Sman-Backend owns directly in `soroman_db`, alongside Django's `public`
schema. See `docs/LIVE_DB_CUTOVER.md` §4 for what's here and why.

## Making a schema change here

`db/migrations.sman/` is tracked, with a journal — `drizzle.sman.config.js`
points at exactly the schema files in this folder and diffs incrementally
against that baseline. (An earlier revision of this README said the folder was
deliberately untracked; that changed when the baseline was committed during
the cutover stabilization.)

For any future change:

1. Edit/add the table in its permanent file here + `db/schema/sman/index.js`.
2. `LIVE_DATABASE_URL=<url> npx drizzle-kit generate --config=drizzle.sman.config.js`
   — generate never connects, but the config refuses to load without the env
   var. Review the SQL it writes: it must be additive only — new
   `CREATE TABLE`/`CREATE TYPE`/`CREATE INDEX`/`ALTER TABLE ... ADD`, nothing
   touching `public.*` beyond bare `REFERENCES` clauses.
3. Apply the reviewed file to the target with plain `psql -f`, or
   `drizzle-kit migrate` with the same config. For production, treat any
   migration that adds a constraint over existing data (unique indexes
   especially) as a data question first — see the header comments inside the
   migration files.

**Never run `drizzle-kit push` against anything real.** Push treats the whole
database as managed by the config's schema list and DROPS every table it
doesn't know about — with `--force` it does so without asking. This was
verified the hard way against a throwaway local DB (it deleted all 81 Django
`public` tables). The generate-review-apply flow above is the only safe path.

## Provisioning a local/CI test database

Both schemas are needed:

1. `psql $TEST_DATABASE_URL -f docs/live_schema.sql` — the 81 Django
   `public` tables (schema-only dump, includes identity sequences).
2. `LIVE_DATABASE_URL=$TEST_DATABASE_URL npx drizzle-kit migrate
   --config=drizzle.sman.config.js` — the `sman` tables from the tracked
   migrations.

Django fills its NOT NULL columns app-side, so the dump has almost no DB
defaults — raw test inserts must supply them. Use `tests/liveFixtures.js`
factories instead of raw inserts.
