# sman schema

Tables Sman-Backend owns directly in `soroman_db`, alongside Django's `public`
schema. See `docs/LIVE_DB_CUTOVER.md` §4 for what's here and why.

## Making a schema change here

There is deliberately no `db/migrations.sman/` tracked in this repo — the
folder was used transiently while building this schema out and then removed.
Because of that, `drizzle-kit migrate` has no local baseline to diff
incrementally against, and regenerating one from scratch produces a
full "create everything" migration that conflicts with what's already live.

For any future addition here:

1. Write the new table(s) in a temp file whose `require`s are minimal (don't
   pull in `./enums.js` unless the new table actually uses one of its enums —
   otherwise drizzle-kit tries to `CREATE TYPE` for enums that already exist).
2. Point a throwaway `drizzle.*.config.js` at just that file, with a fresh
   `out` folder, `dbCredentials.url` = `LIVE_DATABASE_URL`.
3. `drizzle-kit generate` — review the SQL. It should be additive only:
   new `CREATE TABLE`/`CREATE TYPE`/`ALTER TABLE ... ADD CONSTRAINT`, nothing
   touching `public.*` beyond bare `REFERENCES`.
4. `drizzle-kit migrate` with that same config.
5. Delete the throwaway config/schema/migration files, add the real table to
   its permanent file + `db/schema/sman/index.js`.

`drizzle-kit push` is the other option but prompts interactively, which
doesn't work well non-interactively — the scoped-increment approach above is
easier to review and reason about.
